import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('AWS deployment fixture packages a private environment and prepares SSM without exposing local AWS keys', async ({ baseURL }) => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'mythic-deploy-'));
  const root = process.cwd();
  try {
    for (const directory of ['infra/aws', 'scripts', 'bin', 'dist/client', 'dist/server']) mkdirSync(path.join(fixture, directory), { recursive: true });
    for (const file of ['infra/aws/deploy.mjs', 'infra/aws/template.json', 'infra/aws/bootstrap.sh', 'scripts/env.mjs']) copyFileSync(path.join(root, file), path.join(fixture, file));
    writeFileSync(path.join(fixture, 'dist/client/index.html'), '<title>Fixture</title>');
    writeFileSync(path.join(fixture, 'dist/server/index.cjs'), '// fixture');
    writeFileSync(path.join(fixture, '.env'), 'GEMINI_API_KEY=placeholder\nBEDROCK_ENABLED=false\nAWS_ACCESS_KEY_ID=must-not-export\nAWS_SECRET_ACCESS_KEY=must-not-export\n');
    writeFileSync(path.join(fixture, 'bin/npm'), '#!/usr/bin/env node\nprocess.exit(0);\n', { mode: 0o755 });
    writeFileSync(path.join(fixture, 'bin/aws'), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const at = key => args[args.indexOf(key) + 1];
const answer = value => process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value));
const auditFile = path.join(process.cwd(), 'audit.json');
const audit = fs.existsSync(auditFile) ? JSON.parse(fs.readFileSync(auditFile, 'utf8')) : {};
const mark = key => { audit[key] = true; fs.writeFileSync(auditFile, JSON.stringify(audit)); };
const verb = args.slice(0, 2).join(' ');
if (args[0] === '--version') answer('aws-cli/2.fixture');
else if (verb === 'sts get-caller-identity') answer({Account:'123456789012'});
else if (verb === 'ec2 describe-vpcs') answer('vpc-fixture');
else if (verb === 'ec2 describe-subnets') answer(args.includes('--subnet-ids') ? {Subnets:[{VpcId:'vpc-fixture'}]} : 'subnet-fixture');
else if (verb === 'ec2 describe-vpc-attribute') answer({EnableDnsHostnames:{Value:true},EnableDnsSupport:{Value:true}});
else if (verb === 'ec2 describe-managed-prefix-lists') answer('pl-fixture');
else if (verb === 's3api head-bucket') process.exit(1);
else if (['s3api create-bucket','s3api put-public-access-block','s3api put-bucket-encryption'].includes(verb)) answer({});
else if (verb === 's3 cp') {
  const file = args[2];
  if (!fs.existsSync(file)) throw new Error('Missing upload: ' + file);
  if (file.endsWith('runtime.env')) {
    const env = fs.readFileSync(file,'utf8');
    if (/AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/.test(env)) throw new Error('Local AWS keys were exported');
    if (!env.includes('SESSION_SECRET=') || !env.includes('ORIGIN_SECRET=')) throw new Error('Missing runtime secrets');
    mark('privateEnvironment');
  }
  answer({});
}
else if (verb === 'cloudformation validate-template') {
  const template = JSON.parse(fs.readFileSync(at('--template-body').replace('file://',''),'utf8'));
  if (!template.Parameters.OriginSecret.NoEcho) throw new Error('Origin parameter must be hidden');
  if (template.Resources.GameTable.DeletionPolicy !== 'Retain') throw new Error('Data retention missing');
  mark('templateValidation'); answer({});
}
else if (verb === 'cloudformation deploy') {
  const params = JSON.parse(fs.readFileSync(at('--parameter-overrides').replace('file://',''),'utf8'));
  if (!params.some(p => p.ParameterKey === 'OriginSecret' && p.ParameterValue.length >= 32)) throw new Error('Missing secret parameter');
  mark('stackPrepared'); answer({});
}
else if (verb === 'cloudformation describe-stacks') answer({Stacks:[{Outputs:[
  {OutputKey:'URL',OutputValue:process.env.MOCK_PUBLIC_URL},
  {OutputKey:'InstanceId',OutputValue:'i-fixture'},
  {OutputKey:'TableName',OutputValue:'fixture-table'},
  {OutputKey:'DistributionId',OutputValue:'fixture-distribution'}
]}]});
else if (verb === 'ssm describe-instance-information') answer({InstanceInformationList:[{PingStatus:'Online'}]});
else if (verb === 'ssm send-command') {
  const params = JSON.parse(fs.readFileSync(at('--parameters').replace('file://',''),'utf8'));
  if (params.commands.length !== 3 || !params.commands[2].includes('mythic-bootstrap.sh')) throw new Error('Missing bootstrap command');
  mark('ssmPrepared'); answer({Command:{CommandId:'fixture-command'}});
}
else if (verb === 'ssm get-command-invocation') answer({Status:'Success'});
else throw new Error('Unexpected AWS operation: ' + verb);
`, { mode: 0o755 });
    const out = spawnSync(process.execPath, ['infra/aws/deploy.mjs'], {
      cwd: fixture, encoding: 'utf8', timeout: 20_000,
      env: {
        ...process.env, PATH: path.join(fixture, 'bin') + path.delimiter + process.env.PATH,
        STACK_NAME: 'mythic-fixture', AWS_REGION: 'us-east-1', VPC_ID: '', SUBNET_ID: '', ARTIFACT_BUCKET: '',
        SESSION_SECRET: '', ORIGIN_SECRET: '', MOCK_PUBLIC_URL: baseURL!,
        GEMINI_API_KEY: 'placeholder', SUPERMEMORY_API_KEY: 'placeholder', BEDROCK_ENABLED: 'false',
      },
    });
    expect(out.status, out.stderr || out.error?.message || out.stdout).toBe(0);
    const audit = JSON.parse(readFileSync(path.join(fixture, 'audit.json'), 'utf8'));
    expect(audit).toEqual({ privateEnvironment: true, templateValidation: true, stackPrepared: true, ssmPrepared: true });
    expect(out.stdout).not.toContain('must-not-export');
    const state = JSON.parse(readFileSync(path.join(fixture, 'infra/aws/.state/mythic-fixture/deployment.json'), 'utf8'));
    expect(state.url).toBe(baseURL);
    expect(state.table).toBe('fixture-table');
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
