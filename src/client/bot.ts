import { KEY, type Match } from '../shared/sim';
import { resolveLocally } from '../shared/resolve';
import { hash01 } from '../shared/util';

/** A deliberately readable sparring partner: closes for melee, backs off for ranged weapons. */
export class PracticeBot {
  private nextPrompt = 10;

  keys(match: Match): number {
    const s = match.state;
    if (s.phase !== 'fight') return 0;
    const me = s.fighters[1];
    const foe = s.fighters[0];
    const distance = Math.abs(foe.x - me.x);
    const ranged = match.sheets[1].moves.base.delivery !== 'melee';
    const preferred = ranged ? 4.5 : 1.35;
    const toward = foe.x > me.x ? KEY.right : KEY.left;
    let flags = 0;
    if (distance > preferred + 0.5) flags |= toward;
    else if (ranged && distance < 2.6) flags |= toward === KEY.right ? KEY.left : KEY.right;
    const beat = Math.floor(s.t * 2.5);
    if (hash01(11, beat) > 0.38 && (ranged || distance < 2.2)) flags |= me.cd[1] <= 0 && hash01(7, beat) > 0.67 ? KEY.special : KEY.base;
    if (hash01(53, Math.floor(s.t * 1.4)) > 0.9) flags |= KEY.up;
    if (s.t >= this.nextPrompt && match.canPrompt(1)) {
      this.nextPrompt = s.t + 19;
      match.openPrompt(1);
      match.submitPrompt(1);
      // No cloud charge for the CPU. These are never suggested to either human player.
      const text = hash01(5, beat) > 0.55 ? 'dome of light' : 'wind wave';
      const result = resolveLocally(text, 1900);
      match.resolvePrompt(1, result.ok ? result.move : null);
    }
    return flags;
  }
}
