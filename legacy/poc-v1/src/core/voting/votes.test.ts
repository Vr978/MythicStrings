import { describe, expect, it } from 'vitest';
import { castVote, effectiveVoteShare, openVoting, voteShare, votingWindowSec } from './votes';

const T0 = 1_000_000;
const open = () => openVoting('move-1', T0, ['p1', 'p2'], 10);

describe('openVoting', () => {
  it('opens a window of the configured duration, clamped to 1..60 s (Req 16.1)', () => {
    expect(open().closesAt - open().opensAt).toBe(10_000);
    expect(votingWindowSec(0)).toBe(1);
    expect(votingWindowSec(90)).toBe(60);
    expect(votingWindowSec(undefined)).toBe(10);
  });
});

describe('castVote', () => {
  it('accepts up and down votes from spectators inside the window', () => {
    let s = open();
    const a = castVote(s, { voterId: 'spec-a', value: 'up' }, T0 + 1);
    expect(a.result.accepted).toBe(true);
    s = a.state;
    const b = castVote(s, { voterId: 'spec-b', value: 'down' }, T0 + 9_999);
    expect(b.result.accepted).toBe(true);
    expect(b.state.votes.size).toBe(2);
  });

  it('rejects values other than up or down (Req 16.2)', () => {
    const s = open();
    const r = castVote(s, { voterId: 'spec-a', value: 'sideways' }, T0 + 1);
    expect(r.result).toMatchObject({ accepted: false, reason: 'invalid_value' });
    expect(r.state).toBe(s);
  });

  it('rejects a second vote and keeps the first (Req 16.3)', () => {
    const first = castVote(open(), { voterId: 'spec-a', value: 'up' }, T0 + 1).state;
    const r = castVote(first, { voterId: 'spec-a', value: 'down' }, T0 + 2);
    expect(r.result).toMatchObject({ accepted: false, reason: 'duplicate', message: 'A vote has already been cast for that Move.' });
    expect(r.state.votes.get('spec-a')).toBe('up');
  });

  it('rejects combatants (Req 16.5) and votes outside the window (Req 16.6)', () => {
    const s = open();
    expect(castVote(s, { voterId: 'p1', value: 'up' }, T0 + 1).result).toMatchObject({ reason: 'combatant' });
    expect(castVote(s, { voterId: 'spec-a', value: 'up' }, T0 - 1).result).toMatchObject({ reason: 'closed' });
    expect(castVote(s, { voterId: 'spec-a', value: 'up' }, T0 + 10_000).result).toMatchObject({ reason: 'closed' });
  });

  it('does not mutate the input state', () => {
    const s = open();
    castVote(s, { voterId: 'spec-a', value: 'up' }, T0 + 1);
    expect(s.votes.size).toBe(0);
  });
});

describe('voteShare', () => {
  it('is 0.5 with no votes (Req 16.8, 15.9)', () => {
    expect(voteShare(open())).toBe(0.5);
  });
  it('is positives over total (Req 16.7)', () => {
    let s = open();
    for (const [id, v] of [['a', 'up'], ['b', 'up'], ['c', 'down']] as const) {
      s = castVote(s, { voterId: id, value: v }, T0 + 5).state;
    }
    expect(voteShare(s)).toBeCloseTo(2 / 3);
  });
  it('is 0.5 when voting is disabled (Req 16.9)', () => {
    const s = castVote(open(), { voterId: 'a', value: 'down' }, T0 + 5).state;
    expect(effectiveVoteShare(s, false)).toBe(0.5);
    expect(effectiveVoteShare(undefined, true)).toBe(0.5);
    expect(effectiveVoteShare(s, true)).toBe(0);
  });
});
