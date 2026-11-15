// Messages on the online-duel WebSocket, and the fixed view boxes the AI atelier draws into.
import type { MatchState, SimEvent } from './sim';
import type { CharacterSheet, PlayerProfile, ProgressUpdate, ResolvedPrompt, Slot } from './types';

export interface Pick {
  /** Character id. */
  id: string;
  /** true for a forged character owned by the player, false for a legend. */
  custom: boolean;
}

export type ClientMsg =
  | { t: 'create'; player: PlayerProfile; token: string; pick: Pick }
  | { t: 'join'; code: string; player: PlayerProfile; token: string; pick: Pick }
  /** Current KEY flags. Sent only when they change. */
  | { t: 'in'; k: number }
  | { t: 'popen' }
  | { t: 'psubmit'; text: string }
  | { t: 'pcancel' }
  | { t: 'rematch' }
  | { t: 'leave' }
  | { t: 'ping'; at: number };

export interface LobbyPlayer {
  name: string;
  character: string;
  rating: number;
}

/** What both players are told about a resolved mantra. */
export interface PromptVerdict {
  who: 0 | 1;
  text: string;
  ok: boolean;
  reason?: string;
  name: string;
  kind: 'attack' | 'defense';
  mode: 'instant' | 'lingering';
  cost: number;
  source: ResolvedPrompt['source'];
  ms: number;
}

export type ServerMsg =
  | { t: 'room'; code: string; you: 0 | 1; players: (LobbyPlayer | null)[] }
  | { t: 'start'; sheets: [CharacterSheet, CharacterSheet]; you: 0 | 1 }
  | { t: 's'; s: MatchState; ev: SimEvent[] }
  | { t: 'verdict'; v: PromptVerdict }
  | { t: 'end'; winner: 0 | 1 | 2; reason: string; progress: ProgressUpdate[] }
  | { t: 'rematch'; ready: [boolean, boolean] }
  | { t: 'left' }
  | { t: 'error'; message: string }
  | { t: 'pong'; at: number };

export function verdictOf(who: 0 | 1, text: string, r: ResolvedPrompt): PromptVerdict {
  return {
    who, text, ok: r.ok, ...(r.reason ? { reason: r.reason } : {}),
    name: r.move.name, kind: r.move.kind, mode: r.move.mode, cost: r.move.cost, source: r.source, ms: r.ms,
  };
}

export interface SlotBox {
  w: number;
  h: number;
  /** The point of the view box that is pinned to the puppet. */
  ax: number;
  ay: number;
  /** Told to the model so the piece lines up with the body. */
  guide: string;
}

export const SLOT_BOX: Record<Slot, SlotBox> = {
  headgear: {
    w: 120, h: 120, ax: 60, ay: 92,
    guide: 'The head is a circle of radius 25 centred at (60,92), seen in profile facing right (+x). Draw only the headgear, sitting on and above the head; leave the face from x=62 to x=90, y=85 to y=110 uncovered.',
  },
  top: {
    w: 100, h: 110, ax: 50, ay: 100,
    guide: 'The torso is seen from the front: shoulders at y=22 from x=20 to x=80, narrowing to the waist at y=100 from x=32 to x=68. The neck is at (50,16). Draw the garment covering the torso only; arms and head are separate pieces.',
  },
  bottom: {
    w: 120, h: 150, ax: 60, ay: 8,
    guide: 'The waist is at y=8 from x=42 to x=78; the ankles are near y=140. Draw the lower garment hanging from the waist (skirt, dhoti, robe or armour skirt), widening downward.',
  },
  weapon: {
    w: 80, h: 220, ax: 40, ay: 160,
    guide: 'The hand grips at (40,160). The weapon stands upright with its business end toward the top (y=0); any pommel or tail goes below the grip. Keep it within the box.',
  },
};
