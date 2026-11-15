// Voting_Service pure tally (design: "Voting_Service"). In the PoC the audience is local up/down buttons.
import { VOTING_WINDOW_SEC_DEFAULT, VOTING_WINDOW_SEC_MAX, VOTING_WINDOW_SEC_MIN } from '../config';

export type VoteValue = 'up' | 'down';

export interface VoteState {
  moveId: string;
  /** Window is open for timestamps in [opensAt, closesAt), in ms. */
  opensAt: number;
  closesAt: number;
  combatantIds: ReadonlySet<string>;
  /** voterId -> first accepted vote. */
  votes: ReadonlyMap<string, VoteValue>;
}

export interface VoteInput {
  voterId: string;
  /** Untrusted; only 'up' and 'down' are accepted (Req 16.2). */
  value: unknown;
}

export type VoteRejection = 'combatant' | 'closed' | 'duplicate' | 'invalid_value';

export type VoteResult = { accepted: true } | { accepted: false; reason: VoteRejection; message: string };

const REJECTION_MESSAGES: Record<VoteRejection, string> = {
  combatant: 'Combatants cannot vote.',
  closed: 'Voting for that Move is closed.',
  duplicate: 'A vote has already been cast for that Move.',
  invalid_value: 'A vote must be a positive or a negative rating.',
};

/** Clamps a Voting_Window duration to 1..60 s; non-finite values give the 10 s default (Req 16.1). */
export function votingWindowSec(sec: number | undefined): number {
  if (sec === undefined || !Number.isFinite(sec)) return VOTING_WINDOW_SEC_DEFAULT;
  return Math.min(VOTING_WINDOW_SEC_MAX, Math.max(VOTING_WINDOW_SEC_MIN, sec));
}

/** Opens a Voting_Window for a Move at `now` lasting `durationSec` seconds. */
export function openVoting(
  moveId: string,
  now: number,
  combatantIds: Iterable<string>,
  durationSec: number = VOTING_WINDOW_SEC_DEFAULT,
): VoteState {
  return {
    moveId,
    opensAt: now,
    closesAt: now + votingWindowSec(durationSec) * 1000,
    combatantIds: new Set(combatantIds),
    votes: new Map(),
  };
}

export function isVotingOpen(state: VoteState, now: number): boolean {
  return now >= state.opensAt && now < state.closesAt;
}

const reject = (state: VoteState, reason: VoteRejection): { state: VoteState; result: VoteResult } => ({
  state,
  result: { accepted: false, reason, message: REJECTION_MESSAGES[reason] },
});

/**
 * Records a vote if the voter is not a combatant (Req 16.5), the window is open (Req 16.6), the value is
 * 'up' or 'down' (Req 16.2), and the voter has not voted yet (Req 16.3). Rejections return the same state.
 */
export function castVote(state: VoteState, vote: VoteInput, now: number): { state: VoteState; result: VoteResult } {
  if (state.combatantIds.has(vote.voterId)) return reject(state, 'combatant');
  if (!isVotingOpen(state, now)) return reject(state, 'closed');
  if (vote.value !== 'up' && vote.value !== 'down') return reject(state, 'invalid_value');
  if (state.votes.has(vote.voterId)) return reject(state, 'duplicate');
  const votes = new Map(state.votes);
  votes.set(vote.voterId, vote.value);
  return { state: { ...state, votes }, result: { accepted: true } };
}

/** Positive votes / accepted votes, or 0.5 when no votes were accepted (Req 16.7, 16.8). */
export function voteShare(state: VoteState): number {
  const total = state.votes.size;
  if (total === 0) return 0.5;
  let up = 0;
  for (const v of state.votes.values()) if (v === 'up') up++;
  return up / total;
}

/** Vote_Share for the Damage_Scorer: 0.5 whenever voting is disabled or no window exists (Req 16.9). */
export function effectiveVoteShare(state: VoteState | undefined, votingEnabled: boolean): number {
  return votingEnabled && state ? voteShare(state) : 0.5;
}
