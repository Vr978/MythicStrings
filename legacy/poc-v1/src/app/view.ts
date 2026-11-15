// What the turn controller needs from the screen. The browser implementation (domView.ts) wires the
// DOM panels and the PixiJS stage; tests pass a recording fake so the controller runs headless.
import type { Outcome } from '../core/turn/state';
import type { DamageInfo } from '../ui/damagePanel';
import type { MoveInputOpenOptions, Recommendations } from '../ui/moveInput';
import type { Notice } from '../ui/notifications';
import type { VoteOpenOptions } from '../ui/votePanel';

export interface TurnBanner {
  turnNumber: number;
  actorId: string;
  actorName: string;
  /** "Player 1" / "Player 2" (hot-seat, same browser). */
  playerLabel: string;
}

export interface BattleView {
  turnStarted(info: TurnBanner): void;
  /** Opens the Move_Input_Window panel for the acting Player. */
  openInput(options: MoveInputOpenOptions): void;
  updateRecommendations(list: Recommendations): void;
  /** Current text of the Move_Prompt field (read when the countdown reaches 0). */
  inputText(): string;
  /** Disables input (Req 7.9). */
  closeInput(): void;
  /** Re-enables the still-open window after a rejected stored Move (Req 8.8). */
  reopenInput(): void;
  /** Hides the input panel between Turns. */
  hideInput(): void;
  inputError(message: string): void;
  notify(notice: Notice): void;
  /** Starts (`characterId`) or stops (`null`) the looping waiting animation (Req 18.3). */
  setWaiting(characterId: string | null): void;
  setHp(characterId: string, hp: number): void;
  showDamage(info: DamageInfo): void;
  /** Returns false when audience voting is switched off; the Vote_Share is then 0.5 (Req 16.9). */
  openVoting(options: VoteOpenOptions): boolean;
  closeVoting(): void;
  /** Battle result with a "New battle" button. */
  showResult(outcome: Outcome, message: string, onNewBattle: () => void): void;
}
