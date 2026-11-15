import { describe, expect, it } from 'vitest';
import { closeWindowDecision } from './closeWindow';

const sel = { id: 'stored' };

describe('closeWindowDecision', () => {
  it('rejects a blank submit and keeps the window open (Req 7.7)', () => {
    expect(closeWindowDecision('   ', null, 'submit')).toEqual({ kind: 'keep_open', reason: 'empty_prompt' });
    expect(closeWindowDecision('', sel, 'submit')).toEqual({ kind: 'keep_open', reason: 'empty_prompt' });
  });

  it('passes the text exactly as typed on submit or deadline (Req 7.4, 7.5)', () => {
    expect(closeWindowDecision('  fire arrows ', null, 'submit')).toEqual({ kind: 'prompt', text: '  fire arrows ' });
    expect(closeWindowDecision('fire', sel, 'deadline')).toEqual({ kind: 'prompt', text: 'fire' });
  });

  it('passes the selection on explicit select or a blank field at the deadline (Req 7.4, 7.8)', () => {
    expect(closeWindowDecision('typing', sel, 'select')).toEqual({ kind: 'stored', selection: sel });
    expect(closeWindowDecision(' ', sel, 'deadline')).toEqual({ kind: 'stored', selection: sel });
  });

  it('falls back with no_input when the deadline hits an empty field and no selection (Req 7.6)', () => {
    expect(closeWindowDecision('\t', null, 'deadline')).toEqual({ kind: 'fallback', reason: 'no_input' });
  });
});
