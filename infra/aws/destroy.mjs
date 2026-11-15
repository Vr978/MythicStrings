import { readFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const stack = process.env.STACK_NAME || 'mythic-strings';
if (!/^[a-z][a-z0-9-]{1,48}$/.test(stack)) throw new Error('Invalid STACK_NAME.');
const directory = path.join(root, 'infra/aws/.state', stack);
const stateFile = path.join(directory, 'deployment.json');
if (!existsSync(stateFile)) throw new Error('Deployment state was not found. Use the CloudFormation console to delete the intended stack.');
const state = JSON.parse(readFileSync(stateFile, 'utf8'));
const aws = args => {
  const result = spawnSync('aws', [...args, '--region', state.region, '--no-cli-pager'], { stdio: 'inherit', env: { ...process.env, AWS_PAGER: '', AWS_CLI_AUTO_PROMPT: 'off' } });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || 'AWS command failed.');
};
console.log('Deleting stack ' + state.stack + '. This stops its server and removes its CloudFront distribution.');
aws(['cloudformation', 'delete-stack', '--stack-name', state.stack]);
aws(['cloudformation', 'wait', 'stack-delete-complete', '--stack-name', state.stack]);
if (process.argv.includes('--purge-data')) {
  console.log('Removing the retained character table and private release bucket requested by --purge-data.');
  aws(['dynamodb', 'delete-table', '--table-name', state.table]);
  aws(['s3', 'rm', 's3://' + state.bucket, '--recursive', '--only-show-errors']);
  aws(['s3api', 'delete-bucket', '--bucket', state.bucket]);
  rmSync(directory, { recursive: true, force: true });
} else {
  console.log('Retained character data: ' + state.table + '. Private releases: ' + state.bucket);
  console.log('These retained resources can still incur charges. To remove them, rerun with --purge-data, or delete them in AWS.');
}
