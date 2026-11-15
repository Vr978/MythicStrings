import { describe, expect, it } from 'vitest';
import { buildBody, parseInteraction } from '../src/server/ai/gemini';
import { parseConverse } from '../src/server/ai/bedrock';
import { pickRecall } from '../src/server/ai/supermemory';
import { sanitizeSvg } from '../src/server/ai/svg';
import { decodeSketch } from '../src/server/ai/tasks';

describe('AI protocol boundaries', () => {
  it('reads only Gemini model output and preserves grounding citations', () => {
    const result = parseInteraction({ status: 'completed', steps: [
      { type: 'thought', content: [{ type: 'text', text: 'private reasoning' }] },
      { type: 'model_output', content: [{ type: 'text', text: '{"valid":true}', annotations: [{ type: 'url_citation', url: 'https://example.org/myth', title: 'Myth' }] }] },
    ] });
    expect(result.text).toBe('{"valid":true}');
    expect(result.citations).toEqual([{ title: 'Myth', url: 'https://example.org/myth' }]);
    expect(() => parseInteraction({ status: 'failed' })).toThrow('interaction failed');
  });

  it('pins JSON output, keeps requests stateless, and retains the token ceiling on retry', () => {
    const request = { model: 'test', system: 'classify', input: 'shield', maxTokens: 320, thinking: 'minimal', schema: { type: 'object' }, signal: AbortSignal.timeout(1000) };
    const tuned = buildBody(request, true);
    expect(tuned.store).toBe(false);
    expect(tuned.response_format).toMatchObject({ mime_type: 'application/json' });
    expect(buildBody(request, false).generation_config).toEqual({ max_output_tokens: 320 });
    expect(buildBody({ ...request, search: true }, true).tools).toEqual([{ type: 'google_search' }]);
  });

  it('reads Bedrock text blocks and rejects an empty response', () => {
    expect(parseConverse({ output: { message: { content: [{ text: 'a' }, { text: 'b' }] } } })).toBe('ab');
    expect(() => parseConverse({})).toThrow('empty answer');
  });

  it('accepts semantic memories only above threshold with a stored payload', () => {
    expect(pickRecall({ results: [{ similarity: 0.99 }, { similarity: 0.86, metadata: { payload: '{}' } }] }, 0.9)).toBeNull();
    expect(pickRecall({ results: [{ similarity: 0.93, metadata: { payload: '{"kind":"attack"}' } }] }, 0.9)?.similarity).toBe(0.93);
  });
});

describe('uploaded and generated art', () => {
  it('rebuilds SVG without scripts, event handlers, CSS, links, or remote paints', () => {
    const svg = sanitizeSvg('<svg><script>alert(1)</script><image href="https://bad.example"/><path d="M0 0L20 20" onclick="alert(1)" style="fill:red" fill="url(https://bad.example/x)" stroke="#aa3300"/><circle r="5" fill="url(#gold)"/></svg>', 'top');
    expect(svg).toContain('viewBox="0 0 100 110"');
    expect(svg).not.toMatch(/script|href|onclick|style=|bad\.example/);
    expect(svg).toContain('url(#gold)');
    expect(sanitizeSvg('<svg><script/></svg>', 'top')).toBeNull();
  });

  it('validates the sketch signature, MIME type, and decoded size', () => {
    const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(48)]).toString('base64');
    expect(decodeSketch('data:image/png;base64,' + png)?.mime).toBe('image/png');
    expect(decodeSketch('data:image/jpeg;base64,' + png)).toBeNull();
    expect(decodeSketch('data:image/svg+xml;base64,' + png)).toBeNull();
    expect(decodeSketch('A'.repeat(100))).toBeNull();
  });
});
