import { Graphics } from 'pixi.js';
import type { MatchState, SimEvent } from '../../shared/sim';
import type { CharacterSheet } from '../../shared/types';
import { Effects } from './effects';
import { Puppet } from './puppet';
import { FLOOR_Y, Stage, sx, sy } from './stage';

export class Scene {
  private puppets: Puppet[] = [];
  private readonly shadows = new Graphics();
  private readonly effects = new Effects();
  private mode: 'home' | 'select' | 'forge' | 'fight' = 'home';
  private state: MatchState | null = null;
  private time = 0;

  constructor(readonly stage: Stage) {
    stage.layers.puppets.addChild(this.shadows);
    stage.layers.fx.addChild(this.effects.root);
  }

  show(sheets: CharacterSheet[], mode: typeof this.mode): void {
    for (const puppet of this.puppets) puppet.destroy();
    this.mode = mode;
    this.state = null;
    this.effects.clear();
    this.stage.setSlow(false);
    this.stage.setTheme(sheets[0]?.theme ?? 'temple');
    const size = mode === 'home' ? 1.35 : mode === 'forge' ? 1.65 : 1.08;
    this.puppets = sheets.map(sheet => new Puppet(sheet, size));
    this.stage.layers.puppets.addChild(...this.puppets.map(p => p.root));
    // Set every joint and position before Pixi's next draw, including immediately after a forge edit.
    this.update(0);
  }

  setState(state: MatchState): void { this.state = state; }

  events(events: SimEvent[]): void {
    for (const event of events) {
      this.effects.event(event);
      if (event.type === 'hit') {
        this.puppets[event.who]?.hit();
        if (event.heavy) { this.stage.shake(Math.min(8, event.dmg)); this.stage.flash(0.07, 0xffe7bb); }
      }
      if (event.type === 'cast' && event.slot !== 0) this.stage.flash(0.1, 0xffefb7);
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.stage.update(dt, this.time);
    const s = this.state;
    this.shadows.clear();
    this.stage.setSlow(Boolean(s && s.scale < 1));
    for (let i = 0; i < this.puppets.length; i++) {
      const f = s?.fighters[i];
      const x = f ? sx(f.x) : this.mode === 'home' ? 1010 + i * 370 : this.mode === 'forge' ? 440 : 410 + i * 780;
      const y = f ? sy(f.y) : FLOOR_Y;
      this.shadows.ellipse(x, FLOOR_Y + 3, 53, 9).fill({ color: 0x33160b, alpha: 0.18 * (f ? Math.max(0.2, 1 - f.y * 0.2) : 1) });
      this.puppets[i].update(dt * (s?.scale ?? 1), {
        act: f?.act ?? 'idle', actT: f?.actT ?? 0, anim: f?.anim ?? 'swing',
        facing: f?.facing ?? (i === 0 ? 1 : -1), vx: f?.vx ?? 0, grounded: f?.grounded ?? true, time: this.time,
      }, x, y);
    }
    if (s) this.effects.update(s, dt);
  }

  destroy(): void { for (const puppet of this.puppets) puppet.destroy(); this.stage.destroy(); }
}
