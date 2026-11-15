# AWS deployment runbook

## Deployment shape

```text
Browser ── HTTPS / WSS ── CloudFront
                              │
                     restricted HTTP origin
                              │
                    EC2 ARM / Amazon Linux 2023
                      Node.js 22 + systemd
                       │        │        │
                   DynamoDB   Gemini   Bedrock
                                │
                          Supermemory (optional)
```

The server hosts static assets, REST endpoints, and two-seat authoritative WebSocket rooms in one process. CloudFront supplies the public TLS certificate and forwards WebSocket upgrade headers. Dynamic routes have caching disabled; hashed assets are cached.

The origin only accepts CloudFront's managed origin-facing prefix list on port 8787 and checks a deployment-specific secret header. Administration and release installation use AWS Systems Manager, with no SSH port or key pair. The instance role reads private releases, accesses the game table, and can invoke Bedrock. `BEDROCK_ENABLED=false` still prevents model calls until explicitly enabled.

## Prerequisites

- Node.js 22+, npm, tar, and AWS CLI v2 on the deployment machine.
- An AWS CLI identity authorized to create/update CloudFormation, EC2/security groups, an instance role/profile and its policies, a DynamoDB table, and a CloudFront distribution; it also needs S3 uploads, SSM Run Command, relevant describes, and PassRole permissions.
- A default VPC with internet access, or explicit `VPC_ID` and `SUBNET_ID` for a public subnet. Enable VPC DNS hostnames/support. The deployer checks the VPC and subnet association.
- Availability/quota for `t4g.small` (ARM) or `t4g.medium`. The CloudFront prefix-list rule uses AWS's prefix-list quota weight.
- Any desired API keys in the local `.env`. All are optional; placeholders produce a playable local-lore deployment.

The AWS CLI identity stays on your machine. The deployed application uses its EC2 role. The deployer explicitly excludes local AWS access keys and profiles from the uploaded runtime environment.

## First deployment

```sh
aws configure
# Edit .env with any desired provider keys first.
npm run deploy:aws
```

For a different region or public subnet:

```sh
AWS_REGION=us-west-2 VPC_ID=vpc-... SUBNET_ID=subnet-... npm run deploy:aws
```

Optional environment settings: `STACK_NAME` (default `mythic-strings`), `INSTANCE_TYPE`, and `ARTIFACT_BUCKET` (must be a private bucket belonging to your account).

The deployer:

1. Checks your AWS identity, runs the unit suite, and builds the production client/server.
2. Resolves VPC/subnet and CloudFront prefix-list settings.
3. Uploads the release, bootstrap script, and selected runtime settings into a private AES256-encrypted S3 bucket.
4. Calls AWS-side template validation, then creates/updates the stack.
5. Waits for the instance to register with SSM, installs the release, restarts the systemd service, and checks origin health.
6. Confirms the public health endpoint and prints the HTTPS URL.

The first CloudFront deployment can take several minutes. The command fails explicitly if SSM installation or public health cannot be confirmed.

Private deployment state is stored in `infra/aws/.state/<stack>/`; transient packaging files are in `infra/aws/.build/<stack>/`. Both directories are ignored. The state directory contains origin and guest signing keys: back it up privately, especially before deploying an existing stack from another machine. Replacing a signing key invalidates existing browser guest capabilities.

## Verify the published game

```sh
npm run doctor -- --url https://YOUR-DISTRIBUTION.cloudfront.net --online
npm run doctor -- --url https://YOUR-DISTRIBUTION.cloudfront.net --ai
```

The AI check may consume credits. Check its reported source; a memory/cache answer verifies that path, while a Gemini/Bedrock answer verifies the corresponding model response. Without `--ai`, configured paid providers are not probed.

Open the URL on two devices. Create an invite on one, use the link/code on the other, and test movement, attacks, a simultaneous mantra, a disconnect, and a rematch. On each device, online controls are WASD/arrows, K, L, and Q.

The deployment uses DynamoDB automatically. Create a custom puppet, finish human duels, reload, and confirm its rank and win count persist. Local casual results trust the reporting browser; online results are scored by the server.

## Updates and service logs

Edit code or `.env`, then rerun `npm run deploy:aws`. The same stack, DynamoDB table, origin secret, and guest signing key are reused. The systemd process restarts; active rooms end during an update.

To inspect the instance, use an SSM session from the AWS console or CLI, then:

```sh
sudo systemctl status mythic
sudo journalctl -u mythic -n 100 --no-pager
```

Runtime secrets are in `/etc/mythic/env` with restricted permissions. Durable local runtime state, including a fallback guest key, lives in `/var/lib/mythic`. Release directories are under `/opt/mythic/releases`, selected through `/opt/mythic/current`.

## Budget controls

The initial configuration uses one small CPU instance, no GPU, no load balancer, and on-demand DynamoDB. The shared simulator needs no hosted local LLM. CloudFront, public IPv4, EC2/EBS, table storage/PITR, S3, provider tokens, search grounding, and Supermemory can all contribute charges.

The server limits per-client AI HTTP calls and adds process-wide limits for both HTTP and WebSocket AI work. Defaults: 120 model jobs per minute, 1,500 per UTC day, at most 100 smart jobs per day, and eight concurrent jobs. Fallback rules continue play after a limit or timeout. A provider fallback can attempt more than one provider for a job. These counters reset on process restart and are not a provider-side hard dollar cap.

Exact prompts use a local cache. Semantic memory is checked before calling a model. Empty prompts still consume in-game mantra, not cloud tokens. CPU opponents use no cloud calls for their decisions.

The local `.env` can set `AI_DAILY_LIMIT=0` to force cloud generation to fall back while leaving the application and any configured memory service available. To disable memory billing as well, clear `SUPERMEMORY_API_KEY`.

Check your promotion's service eligibility and provider billing console before enabling paid providers. New Google Cloud Welcome credits do not cover the direct Gemini Developer API; [Google documents that exclusion](https://aistudio.google.com/docs/billing#cloud-credits). This code includes a Gemini Developer API adapter, not a Vertex AI/Gemini-platform adapter.

## Teardown

```sh
# Removes the server/distribution/role/security group; retains character data and private releases.
npm run destroy:aws

# Also permanently deletes the retained DynamoDB table and release bucket.
npm run destroy:aws -- --purge-data
```

Use the same `STACK_NAME` used during deployment. The retained table and bucket can still incur charges after a normal teardown. The purge option deliberately removes their data; keep anything you want before running it.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| No default VPC | Supply a VPC and public subnet with an internet-gateway route; enable DNS hostnames/support |
| EC2 does not become SSM Online | Instance role, outbound internet, subnet route, EC2 system log |
| CloudFront 502/503/504 | Service logs, public DNS, origin port, prefix-list rule, secret-header configuration |
| HTTP works but an online room does not start | Use the CloudFront HTTPS URL; dynamic origin behavior must forward upgrade headers and disable caching |
| Local lore mode despite a provider key | Placeholder detection, restarted service, model ID/access/region, AI allowances, provider quota |
| Forge shows a local pattern for a sketch | The multimodal call failed or no provider is configured; the fallback intentionally does not claim sketch interpretation |
| Guest collection disappeared | Browser storage or signing key changed; guest capabilities have no email/account recovery |
| A room ends during redeployment | Rooms are in one server process and do not survive restart |

## Container alternative

```sh
docker build -t mythic-strings .
docker run --rm -p 8787:8787 --env-file .env -e HOST=0.0.0.0 -e DATA_DIR=/app/.data -v mythic-data:/app/.data mythic-strings
```

This is an optional local/container path; the AWS deployer does not require Docker. The container image includes no `.env` or source credentials.
