// Amazon Bedrock through the Converse API. With a Bedrock API key the documented bearer-token HTTPS
// call is used; otherwise the AWS SDK signs with whatever the credential chain provides (the EC2
// instance role in production, a profile in development).
import { BedrockRuntimeClient, ConverseCommand, type ContentBlock, type ImageFormat } from '@aws-sdk/client-bedrock-runtime';
import { config } from '../config';

export interface BedrockRequest {
  model: string;
  system: string;
  user: string;
  image?: { mime: string; b64: string };
  maxTokens: number;
  signal: AbortSignal;
}

let client: BedrockRuntimeClient | null = null;

function imageFormat(mime: string): ImageFormat {
  const f = mime.replace('image/', '').replace('jpg', 'jpeg');
  return (['png', 'jpeg', 'gif', 'webp'].includes(f) ? f : 'png') as ImageFormat;
}

/** Joins the text blocks of a Converse response. */
export function parseConverse(body: unknown): string {
  const b = (body ?? {}) as { output?: { message?: { content?: { text?: string }[] } } };
  const text = (b.output?.message?.content ?? []).map((c) => c.text ?? '').join('');
  if (!text.trim()) throw new Error('bedrock: empty answer');
  return text;
}

async function viaBearer(req: BedrockRequest): Promise<string> {
  const content: unknown[] = [{ text: req.user }];
  if (req.image) content.push({ image: { format: imageFormat(req.image.mime), source: { bytes: req.image.b64 } } });
  const res = await fetch(`https://bedrock-runtime.${config.bedrock.region}.amazonaws.com/model/${encodeURIComponent(req.model)}/converse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.bedrock.token}` },
    body: JSON.stringify({
      messages: [{ role: 'user', content }],
      system: [{ text: req.system }],
      inferenceConfig: { maxTokens: req.maxTokens },
    }),
    signal: req.signal,
  });
  if (!res.ok) throw new Error(`bedrock: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
  return parseConverse(await res.json());
}

async function viaSdk(req: BedrockRequest): Promise<string> {
  client ??= new BedrockRuntimeClient({ region: config.bedrock.region, maxAttempts: 1 });
  const content: ContentBlock[] = [{ text: req.user }];
  if (req.image) content.push({ image: { format: imageFormat(req.image.mime), source: { bytes: Buffer.from(req.image.b64, 'base64') } } });
  const out = await client.send(
    new ConverseCommand({
      modelId: req.model,
      messages: [{ role: 'user', content }],
      system: [{ text: req.system }],
      inferenceConfig: { maxTokens: req.maxTokens },
    }),
    { abortSignal: req.signal },
  );
  return parseConverse(out);
}

export function bedrock(req: BedrockRequest): Promise<string> {
  return config.bedrock.token ? viaBearer(req) : viaSdk(req);
}
