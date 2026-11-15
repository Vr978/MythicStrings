import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readEnv, writeEnv, isPlaceholder } from '../../scripts/env.mjs';

process.umask(0o077);
const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
const local = readEnv(path.join(root, '.env'));
const region = process.env.AWS_REGION || local.AWS_REGION || 'us-east-1';
const stack = process.env.STACK_NAME || 'mythic-strings';
if (!/^[a-z][a-z0-9-]{1,48}$/.test(stack)) throw new Error('STACK_NAME must be 2–49 lowercase letters, digits, or hyphens, starting with a letter.');
if (!/^[a-z]{2}-[a-z]+-\d+$/.test(region)) throw new Error('Choose a standard AWS region such as us-east-1.');
const stateDir = path.join(root, 'infra/aws/.state', stack);
const buildDir = path.join(root, 'infra/aws/.build', stack);
mkdirSync(stateDir, { recursive: true, mode: 0o700 });
mkdirSync(buildDir, { recursive: true, mode: 0o700 });

function run(command, args, capture = false, allowFailure = false) {
  const out = spawnSync(command, args, {
    cwd: root, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit',
    env: { ...process.env, AWS_PAGER: '', AWS_CLI_AUTO_PROMPT: 'off' },
  });
  if ((out.error || out.status !== 0) && !allowFailure) throw new Error(out.error?.message || (capture ? out.stderr?.trim() : '') || command + ' failed');
  return out;
}
const aws = (args, options = {}) => run('aws', [...args, '--region', region, '--no-cli-pager'], options.capture ?? false, options.allowFailure ?? false);
const awsJSON = args => JSON.parse(aws([...args, '--output', 'json'], { capture: true }).stdout);
const outputOf = (outputs, key) => outputs.find(o => o.OutputKey === key)?.OutputValue;
const quote = value => "'" + String(value).replaceAll("'", "'\"'\"'") + "'";
const secret = (name, filename) => {
  const supplied = process.env[name] || local[name];
  const file = path.join(stateDir, filename);
  if (!isPlaceholder(supplied)) { writeFileSync(file, supplied, { mode: 0o600 }); return supplied; }
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const value = randomBytes(36).toString('hex');
  writeFileSync(file, value, { mode: 0o600 });
  return value;
};

try {
  run('aws', ['--version'], true);
  const account = awsJSON(['sts', 'get-caller-identity']).Account;
  const bucket = process.env.ARTIFACT_BUCKET || stack + '-artifacts-' + account + '-' + region;
  const release = Date.now().toString(36) + '-' + randomBytes(3).toString('hex');
  const artifactKey = 'releases/' + release + '/game-' + release + '.tgz';
  const envKey = 'releases/' + release + '/runtime.env';
  const bootstrapKey = 'releases/' + release + '/bootstrap.sh';
  console.log('Preparing ' + stack + ' in ' + region + ': EC2 t4g.small, DynamoDB, CloudFront HTTPS + WebSockets.');
  console.log('The deployer uses your AWS CLI identity; it never copies AWS access keys to the server.');
  if (!existsSync('.env')) console.log('No .env found: deploying the complete game in local lore mode.');

  run('npm', ['test']);
  run('npm', ['run', 'build']);
  const vpcId = process.env.VPC_ID || aws(['ec2', 'describe-vpcs', '--filters', 'Name=is-default,Values=true', '--query', 'Vpcs[0].VpcId', '--output', 'text'], { capture: true }).stdout.trim();
  if (!/^vpc-[a-z0-9]+$/.test(vpcId)) throw new Error('No default VPC found. Set VPC_ID and SUBNET_ID to a VPC and public subnet with internet access.');
  const subnetId = process.env.SUBNET_ID || aws(['ec2', 'describe-subnets', '--filters', 'Name=vpc-id,Values=' + vpcId, 'Name=default-for-az,Values=true', '--query', 'Subnets[0].SubnetId', '--output', 'text'], { capture: true }).stdout.trim();
  if (!/^subnet-[a-z0-9]+$/.test(subnetId)) throw new Error('Set SUBNET_ID to a public subnet in the chosen VPC.');
  const dns = awsJSON(['ec2', 'describe-vpc-attribute', '--vpc-id', vpcId, '--attribute', 'enableDnsHostnames']);
  if (!dns.EnableDnsHostnames?.Value) throw new Error('Enable DNS hostnames on the selected VPC before deploying.');
  const dnsSupport = awsJSON(['ec2', 'describe-vpc-attribute', '--vpc-id', vpcId, '--attribute', 'enableDnsSupport']);
  if (!dnsSupport.EnableDnsSupport?.Value) throw new Error('Enable DNS support on the selected VPC before deploying.');
  const subnet = awsJSON(['ec2', 'describe-subnets', '--subnet-ids', subnetId]).Subnets?.[0];
  if (subnet?.VpcId !== vpcId) throw new Error('SUBNET_ID must belong to VPC_ID.');
  const prefixList = aws(['ec2', 'describe-managed-prefix-lists', '--filters', 'Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing', '--query', 'PrefixLists[0].PrefixListId', '--output', 'text'], { capture: true }).stdout.trim();
  if (!/^pl-[a-z0-9]+$/.test(prefixList)) throw new Error('CloudFront origin-facing prefix list was not found in this region.');

  if (aws(['s3api', 'head-bucket', '--bucket', bucket], { capture: true, allowFailure: true }).status !== 0) {
    aws(['s3api', 'create-bucket', '--bucket', bucket, ...(region === 'us-east-1' ? [] : ['--create-bucket-configuration', 'LocationConstraint=' + region])], { capture: true });
  }
  aws(['s3api', 'put-public-access-block', '--bucket', bucket, '--public-access-block-configuration', 'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'], { capture: true });
  aws(['s3api', 'put-bucket-encryption', '--bucket', bucket, '--server-side-encryption-configuration', JSON.stringify({ Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] })], { capture: true });

  const originSecret = secret('ORIGIN_SECRET', 'origin-secret');
  const values = {};
  // Export only runtime settings. In particular, never export AWS_ACCESS_KEY_ID or a local profile.
  const allowed = /^(GEMINI_|BEDROCK_|SUPERMEMORY_|AI_|PROMPT_BUDGET_MS$|SUMMON_BUDGET_MS$|ATELIER_BUDGET_MS$|AWS_BEARER_TOKEN_BEDROCK$)/;
  for (const [name, value] of Object.entries({ ...local, ...process.env })) if (allowed.test(name) && value !== undefined) values[name] = value;
  values.ORIGIN_SECRET = originSecret;
  values.SESSION_SECRET = secret('SESSION_SECRET', 'session-secret');
  const envFile = path.join(buildDir, 'runtime.env');
  writeFileSync(envFile, writeEnv(values), { mode: 0o600 });
  const archive = path.join(buildDir, 'game.tgz');
  run('tar', ['-czf', archive, 'dist']);
  for (const [file, key] of [[archive, artifactKey], [envFile, envKey], [path.join(root, 'infra/aws/bootstrap.sh'), bootstrapKey]]) {
    aws(['s3', 'cp', file, 's3://' + bucket + '/' + key, '--sse', 'AES256', '--only-show-errors']);
  }

  const parameters = {
    VpcId: vpcId, SubnetId: subnetId, CloudFrontPrefixListId: prefixList, ArtifactBucket: bucket,
    ArtifactKey: artifactKey, EnvKey: envKey, BootstrapKey: bootstrapKey, OriginSecret: originSecret,
    InstanceType: process.env.INSTANCE_TYPE || 't4g.small',
  };
  const parameterFile = path.join(buildDir, 'parameters.json');
  writeFileSync(parameterFile, JSON.stringify(Object.entries(parameters).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue }))), { mode: 0o600 });
  const template = path.join(root, 'infra/aws/template.json');
  aws(['cloudformation', 'validate-template', '--template-body', 'file://' + template], { capture: true });
  console.log('Provisioning the stack. CloudFront can take several minutes on its first deployment.');
  aws(['cloudformation', 'deploy', '--template-file', template, '--stack-name', stack, '--parameter-overrides', 'file://' + parameterFile, '--capabilities', 'CAPABILITY_IAM', '--no-fail-on-empty-changeset', '--tags', 'Project=MythicStrings']);

  const outputs = awsJSON(['cloudformation', 'describe-stacks', '--stack-name', stack]).Stacks[0].Outputs;
  const instance = outputOf(outputs, 'InstanceId');
  const table = outputOf(outputs, 'TableName');
  const url = outputOf(outputs, 'URL');
  const deployment = { stack, region, bucket, instance, table, url, distribution: outputOf(outputs, 'DistributionId'), release };
  writeFileSync(path.join(stateDir, 'deployment.json'), JSON.stringify(deployment, null, 2) + '\n', { mode: 0o600 });
  console.log('Waiting for Systems Manager, then installing the verified release.');
  let online = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const info = awsJSON(['ssm', 'describe-instance-information', '--filters', 'Key=InstanceIds,Values=' + instance]);
    if (info.InstanceInformationList?.[0]?.PingStatus === 'Online') { online = true; break; }
    await delay(5000);
  }
  if (!online) throw new Error('The instance did not register with SSM. Check the subnet route to the internet and the EC2 system log, then rerun deployment.');
  const commands = [
    'set -eu',
    ['aws', 's3', 'cp', 's3://' + bucket + '/' + bootstrapKey, '/tmp/mythic-bootstrap.sh', '--region', region, '--only-show-errors'].map(quote).join(' '),
    ['bash', '/tmp/mythic-bootstrap.sh', bucket, artifactKey, envKey, table, region].map(quote).join(' '),
  ];
  const commandFile = path.join(buildDir, 'command.json');
  writeFileSync(commandFile, JSON.stringify({ commands, executionTimeout: ['600'] }));
  const commandId = awsJSON(['ssm', 'send-command', '--instance-ids', instance, '--document-name', 'AWS-RunShellScript', '--parameters', 'file://' + commandFile]).Command.CommandId;
  let installed = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    const result = aws(['ssm', 'get-command-invocation', '--command-id', commandId, '--instance-id', instance, '--output', 'json'], { capture: true, allowFailure: true });
    if (result.status === 0) {
      const status = JSON.parse(result.stdout);
      if (status.Status === 'Success') { installed = true; break; }
      if (['Failed', 'TimedOut', 'Cancelled'].includes(status.Status)) throw new Error('Remote install ' + status.Status + '. ' + status.StandardErrorContent);
    }
    await delay(5000);
  }
  if (!installed) throw new Error('Remote installation timed out. Inspect the SSM Run Command output before retrying.');
  for (let attempt = 0; attempt < 24; attempt++) {
    try {
      const response = await fetch(url + '/api/health', { signal: AbortSignal.timeout(8000) });
      if (response.ok && (await response.json()).ok) {
        console.log('\nYour theatre is live: ' + url);
        console.log('Verify online rooms: npm run doctor -- --url ' + url + ' --online');
        console.log('Verify paid AI after adding keys: npm run doctor -- --url ' + url + ' --ai');
        console.log('Keep infra/aws/.state private and backed up; it preserves guest signing keys across instance replacement.');
        process.exit(0);
      }
    } catch { /* The distribution may still be reaching its new origin. */ }
    await delay(5000);
  }
  throw new Error('Installation succeeded, but public health could not be confirmed yet. Check ' + url + '/api/health and rerun the doctor.');
} catch (error) {
  console.error('Deployment stopped: ' + error.message);
  process.exitCode = 1;
}
