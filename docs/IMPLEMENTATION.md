# Continuation record and execution plan

## Starting point

The interrupted session had archived the original proof of concept under `legacy/poc-v1/` and implemented the shared real-time simulation, move/character catalogues, AI adapters, persistence, authoritative WebSocket server, and the basic leather puppet and stage renderer.

It stopped at `src/client/render/stage.ts`. There was no browser entry point, screen flow, effect renderer, client controller, HUD, forge UI, deployment implementation, or root runbook. The baseline passed 32 rules tests and type-checking, but could not build a playable browser application.

## Executed plan

| Step | Implementation | Verification |
| --- | --- | --- |
| 1. Preserve and audit | Kept the legacy PoC and all saved shared/server/render code; compared it with the attached transcript | Baseline tests and type-check |
| 2. Complete the renderer | Shared collision geometry drives arrows, spears, rain, beams, waves, melee arcs, bursts, and shield forms; hit particles and damage labels | Desktop and mobile screenshots; live browser combat |
| 3. Connect the client | Home, selection, search, summon, local/CPU controls, online rooms, results and rematches | Browser flows and a real local knockout |
| 4. Build the forge | Appearance, six clothing/body controls plus colours/ornaments, ten weapons, weapon-specific move choices, SVG atelier with text/sketch upload, save/edit/delete | Browser save/edit/reload; API normalization and SVG checks |
| 5. Complete real-time prompts | Independent five-second input windows, timeout submission, provider fallback, verdict display, separate stamina/mantra costs | Simultaneous local and independent online prompts |
| 6. Harden state boundaries | Guest capability tokens, server-derived stats and progression, immutable legend sheets, SVG and image validation, stale input expiry, disconnect forfeits | Ownership/API regression tests and persistence tests |
| 7. Protect the demo budget | Provider deadlines, output ceilings, exact cache, semantic memory before paid generation, client/global/daily/concurrency limits | Provider-boundary and normalization tests |
| 8. Prepare deployment | ARM EC2 + systemd, DynamoDB, CloudFront HTTPS/WebSockets, private S3 releases, restricted origin, SSM updates, Docker alternative, doctor and teardown | Build; shell/JS/JSON checks; AWS stack fixture validation; live cloud checks remain below |
| 9. Document and hand off | Placeholder `.env`, run instructions, gameplay rules, architecture, deployment and credit notes | Linked root README and deployment runbook |

## Design decisions retained

- One deterministic 60 Hz TypeScript engine runs in the browser for local play and on the server for online play. Online clients send input and text, never HP or damage.
- The online server sends snapshots at 30 Hz. One process owns all rooms; run one instance unless the room architecture is changed.
- The renderer builds actual coloured, jointed, translucent leather-style pieces with outlines, punched details, rods, rivets, spring-driven limbs, and characteristic clothing. Generated pieces are SVG assets attached to the appropriate body slot.
- Fixed six-criterion legend ratings and ten custom ranks preserve the earlier session's balancing choices.
- The two-minute cap now measures real time, fixing the previous behavior in which slow motion extended the duel.
- A canceled/empty mantra still consumes a small amount of mantra, preventing unlimited free slow motion.
- The CPU uses local decisions and cannot spend cloud credits. It is a practice opponent, not a source of progression.
- The application contains no spectator voting or move-suggestion flow.

## Trust and operational boundaries

Guest ownership is a signed capability stored in the browser. Player IDs visible to an opponent are insufficient to edit that player's characters. The guest signing key persists independently of each release; keep deployment state private and backed up.

Local results are reported by the local browser and are appropriate for casual progression. Online results are authoritative. This is not an account-recovery system or a tamper-proof ranked tournament service. Clearing browser storage loses that browser's guest capability.

Network loss forfeits the current online duel. A new invite starts a new session; reconnect/resume of an active duel is not implemented. Updating/restarting the single server interrupts active rooms.

Daily AI ceilings are process-local and reset on server restart/UTC date changes. They are request ceilings, not a guaranteed dollar spending cap. Supermemory has its own billing and ingestion behavior. Infrastructure and data storage remain billable while retained.

## Verification and credential-dependent checks

Completed locally:

- TypeScript and production client/server builds.
- 43 unit/rules/provider/persistence/room tests, including authoritative timeout, rank-aware rematches, and proxy address handling.
- Six browser/API integration cases using Chrome and a temporary isolated server: ownership and normalization, progression, local gameplay with simultaneous mantras and a knockout, forge save/edit/reload, two-browser invite play and forfeit, mobile layout bounds.
- An offline AWS deployment fixture and an integration check of the production doctor, for eight integration cases overall.
- Visual inspection of generated home, forge, duel, and mobile screenshots.
- Deployment script syntax, CloudFormation structure, and an offline fixture exercising AWS deploy/bootstrap command preparation without creating resources.

Still requires the credentials and execution the user reserved for themselves:

1. Add a valid Gemini key and/or enable Bedrock for an eligible AWS account. Confirm model access and regional availability.
2. Add Supermemory if desired; allow time for ingestion before expecting a semantic cache hit.
3. Run the AWS deployer to perform AWS-side template validation, actual provisioning, public HTTPS/WSS, and DynamoDB checks.
4. Run `npm run doctor -- --url <returned-url> --online --ai`, then test the published URL from two separate devices.
5. Confirm promotion coverage and observed spend in the relevant provider consoles; tear down the demo infrastructure afterward.

No live model, DynamoDB, or paid AWS resource was invoked while completing this continuation.

## Documentation checked

Official documentation was consulted on November 15, 2026:

| Area | Primary source |
| --- | --- |
| PixiJS 8 drawing API | [Graphics fills and gradients](https://pixijs.com/8.x/guides/components/scene-objects/graphics/graphics-fill) and installed TypeScript declarations |
| Gemini model IDs | [Models](https://aistudio.google.com/docs/models), [Flash-Lite](https://aistudio.google.com/docs/models/gemini-3.5-flash-lite) |
| Gemini request/response protocol | [Interactions](https://aistudio.google.com/docs/interactions-overview), [structured output](https://aistudio.google.com/docs/structured-output), [thinking levels](https://aistudio.google.com/docs/thinking) |
| Gemini credit eligibility | [Billing](https://aistudio.google.com/docs/billing#cloud-credits) |
| Bedrock model/API | [Claude Haiku 5.5 model card and inference IDs](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-haiku-5-5.html), [Converse API](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html) |
| Supermemory v5 | [Quickstart](https://supermemory.ai/docs/quickstart), [namespace search](https://supermemory.ai/docs/v5/api-reference/recall-search/search-memories) |
| Runtime installation | [Node.js on Amazon Linux 2023](https://docs.aws.amazon.com/linux/al2023/ug/nodejs.html) |
| AWS deployment | [CloudFormation deploy parameters](https://docs.aws.amazon.com/cli/latest/reference/cloudformation/deploy.html), [EC2 resource](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ec2-instance.html), [CloudFront custom origin](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-cloudfront-distribution-customoriginconfig.html) |
| HTTPS/WSS forwarding | [CloudFront WebSockets](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/distribution-working-with.websockets.html), [origin restriction](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/restrict-access-to-load-balancer.html), [managed prefix list](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/LocationsOfEdgeServers.html) |
| Cache behavior | [Managed cache policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html), [managed origin request policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-origin-request-policies.html) |
| Rate limits behind CloudFront | [Client IP forwarding for custom origins](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/RequestAndResponseBehaviorCustomOrigin.html#client-ip-addresses) |
| Browser testing | [Playwright configuration](https://playwright.dev/docs/test-configuration) |

Documentation compatibility and offline tests do not substitute for running paid integrations against the user's actual account, keys, quotas, and network.
