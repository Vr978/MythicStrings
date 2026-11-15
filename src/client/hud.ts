import { derive } from '../shared/balance';
import type { PromptVerdict } from '../shared/protocol';
import { KEY, lockSeconds, type MatchState } from '../shared/sim';
import type { CharacterSheet } from '../shared/types';
import type { DuelMode } from './duel';
import type { Input } from './input';
import { $, escape, text } from './ui';

interface Hooks { open: (who: 0 | 1) => void; submit: (who: 0 | 1) => void; cancel: (who: 0 | 1) => void; }

export class Hud {
  private readonly root: HTMLElement;
  private readonly promptPhase = [0, 0];
  private readonly labels: [string, string];
  private readonly playerEls: HTMLElement[];
  private readonly promptEls: HTMLElement[];
  private readonly fields: HTMLTextAreaElement[];
  private readonly actions: HTMLButtonElement[][];
  private readonly clock: HTMLElement;
  private readonly intro: HTMLElement;
  private readonly verdictEl: HTMLElement;
  private verdictTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(host: HTMLElement, readonly sheets: [CharacterSheet, CharacterSheet], readonly mode: DuelMode, readonly you: 0 | 1, input: Input, hooks: Hooks) {
    this.labels = mode === 'online' ? [you === 0 ? 'You' : 'Rival', you === 1 ? 'You' : 'Rival'] : ['Player 1', mode === 'cpu' ? 'Practice partner' : 'Player 2'];
    host.innerHTML = `<div class="battle-ui">
      <div class="scoreboard">
        ${this.playerMarkup(0)}
        <div class="match-clock"><span class="eyebrow">DUEL OF LEGENDS</span><strong id="match-time">2:00</strong><span class="clock-caption">REAL TIME</span></div>
        ${this.playerMarkup(1)}
      </div>
      <div class="intro-count" aria-live="assertive">3</div>
      <div class="verdict" role="status" hidden></div>
      <div class="battle-bottom">
        ${this.controlsMarkup(0)}
        <div class="battle-hint"><span>THINK IT. TYPE IT. WIELD IT.</span><small>5 seconds to rewrite your fate.</small></div>
        ${this.controlsMarkup(1)}
      </div>
      <div class="touch-movement">${[0, 1].map(who => `<div class="touch-pad" data-pad="${who}">${[['left', '←'], ['down', '↓'], ['up', '↑'], ['right', '→']].map(([key, name]) => `<button aria-label="Player ${who + 1} ${key}" data-who="${who}" data-key="${key}">${name}</button>`).join('')}</div>`).join('')}</div>
      <div class="prompt-panels">${[0, 1].map(who => `<form class="prompt-panel" data-prompt="${who}" hidden>
        <div class="prompt-top"><span class="eyebrow">${escape(this.labels[who])} · SPEAK YOUR MANTRA</span><strong data-countdown>5.0s</strong></div>
        <textarea aria-label="Player ${who + 1} mantra" maxlength="80" rows="2" placeholder="Describe your attack or defense…" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>
        <div class="prompt-footer"><small data-prompt-status>Enter to cast · Esc to cancel</small><button class="btn small" type="submit">Cast mantra ↗</button></div>
        <div class="prompt-time"><i></i></div>
      </form>`).join('')}</div>
    </div>`;
    this.root = $('.battle-ui', host);
    this.playerEls = [...host.querySelectorAll<HTMLElement>('.fighter-hud')];
    this.promptEls = [...host.querySelectorAll<HTMLElement>('.prompt-panel')];
    this.fields = [...host.querySelectorAll<HTMLTextAreaElement>('.prompt-panel textarea')];
    this.actions = [0, 1].map(i => [...host.querySelectorAll<HTMLButtonElement>('[data-controls="' + i + '"] button')]);
    this.clock = $('#match-time', host);
    this.intro = $('.intro-count', host);
    this.verdictEl = $('.verdict', host);

    for (const who of [0, 1] as const) {
      const form = this.promptEls[who] as HTMLFormElement;
      form.addEventListener('submit', e => { e.preventDefault(); hooks.submit(who); });
      this.fields[who].addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); hooks.submit(who); }
        if (e.key === 'Escape') { e.preventDefault(); hooks.cancel(who); }
      });
    }
    for (const button of host.querySelectorAll<HTMLButtonElement>('[data-key]')) {
      const who = Number(button.dataset.who) as 0 | 1;
      const key = button.dataset.key!;
      if (!this.controlled(who)) { button.disabled = true; continue; }
      if (key === 'prompt') { button.addEventListener('click', () => hooks.open(who)); continue; }
      const flag = KEY[key as keyof typeof KEY];
      const seat = mode === 'online' ? 0 : who;
      button.addEventListener('pointerdown', e => {
        e.preventDefault(); button.setPointerCapture(e.pointerId); input.pointer(seat, flag, true);
        const up = (event: PointerEvent) => {
          if (event.pointerId !== e.pointerId) return;
          input.pointer(seat, flag, false);
          window.removeEventListener('pointerup', up);
          window.removeEventListener('pointercancel', up);
        };
        window.addEventListener('pointerup', up);
        window.addEventListener('pointercancel', up);
      });
      const release = () => input.pointer(seat, flag, false);
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('lostpointercapture', release);
    }
  }

  private controlled(who: number): boolean { return this.mode === 'online' ? who === this.you : this.mode !== 'cpu' || who === 0; }

  private playerMarkup(who: 0 | 1): string {
    const sheet = this.sheets[who];
    return `<section class="fighter-hud fighter-${who}" aria-label="${escape(sheet.name)} resources">
      <div class="fighter-heading"><div><span class="eyebrow">${escape(this.labels[who])} <span class="muted">/ ${escape(sheet.origin)}</span></span><h2>${escape(sheet.name)}</h2></div><strong class="hp-number">${sheet.rating}<small> HP</small></strong></div>
      <div class="resource health" role="progressbar" aria-label="${escape(sheet.name)} health" aria-valuemin="0" aria-valuemax="${sheet.rating}" aria-valuenow="${sheet.rating}"><i></i></div>
      <div class="resource-label"><span>STAMINA</span><span data-stamina>100</span></div><div class="resource stamina"><i></i></div>
      <div class="resource-label"><span>MANTRA</span><span data-mantra>READY</span></div><div class="resource mantra"><i></i></div>
    </section>`;
  }

  private controlsMarkup(who: 0 | 1): string {
    const sheet = this.sheets[who];
    const primary = this.mode === 'online' || who === 0;
    const keys = primary ? ['K', 'L', 'Q'] : [',', '.', 'R ⇧'];
    return `<div class="fighter-actions" data-controls="${who}">
      <div class="movement-caption">${escape(this.labels[who])} <span>${primary ? 'W A S D' : '↑ ← ↓ →'} · MOVE / JUMP / DUCK</span></div>
      <div class="move-row">${[sheet.moves.base, sheet.moves.special].map((move, i) => `<button class="move-button" data-who="${who}" data-key="${i === 0 ? 'base' : 'special'}"><kbd>${keys[i]}</kbd><span>${escape(move.name)}<small data-move-status>${move.cost} stamina</small></span></button>`).join('')}
      <button class="move-button mantra-button" data-who="${who}" data-key="prompt"><kbd>${keys[2]}</kbd><span>Mantra<small data-move-status>Slow time + type</small></span></button></div>
    </div>`;
  }

  text(who: 0 | 1): string { return this.fields[who]?.value ?? ''; }

  update(state: MatchState): void {
    const seconds = Math.ceil(state.clock);
    text(this.clock, Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0'));
    this.clock.classList.toggle('urgent', seconds <= 20);
    this.root.classList.toggle('slow', state.scale < 1);
    this.intro.hidden = state.phase !== 'intro';
    text(this.intro, state.intro > 1 ? String(Math.ceil(state.intro) - 1) : 'DUEL');
    for (const who of [0, 1] as const) {
      const f = state.fighters[who];
      const node = this.playerEls[who];
      text($('.hp-number', node), Math.ceil(f.hp) + ' HP');
      const health = $('.health', node);
      health.setAttribute('aria-valuenow', String(Math.round(f.hp)));
      ($('i', health) as HTMLElement).style.width = f.hp / f.maxHp * 100 + '%';
      ($('.stamina i', node) as HTMLElement).style.width = f.stamina + '%';
      ($('.mantra i', node) as HTMLElement).style.width = f.mantra + '%';
      text($('[data-stamina]', node), String(Math.floor(f.stamina)));
      text($('[data-mantra]', node), f.locked ? Math.ceil(lockSeconds(f, derive(this.sheets[who]).mantraRegen)) + 's' : f.prompt ? 'WRITING' : 'READY');
      const buttons = this.actions[who];
      for (const slot of [0, 1] as const) {
        const move = slot === 0 ? this.sheets[who].moves.base : this.sheets[who].moves.special;
        buttons[slot].disabled = !this.controlled(who) || state.phase !== 'fight' || f.cd[slot] > 0 || f.stamina < move.cost || f.prompt !== 0;
        text($('[data-move-status]', buttons[slot]), f.cd[slot] > 0 ? f.cd[slot].toFixed(1) + 's' : move.cost + ' stamina');
      }
      buttons[2].disabled = !this.controlled(who) || f.locked || f.prompt !== 0 || state.phase !== 'fight';
      text($('[data-move-status]', buttons[2]), f.locked ? 'Recharging ' + Math.floor(f.mantra) + '%' : 'Slow time + type');
      const form = this.promptEls[who];
      const phase = this.controlled(who) ? f.prompt : 0;
      form.hidden = phase === 0;
      if (phase === 1 && this.promptPhase[who] !== 1) {
        this.fields[who].value = '';
        this.fields[who].disabled = false;
        this.fields[who].focus();
      }
      if (phase === 0 && this.promptPhase[who] !== 0) this.fields[who].blur();
      if (phase) {
        this.fields[who].disabled = phase === 2;
        text($('[data-countdown]', form), phase === 2 ? 'READING…' : Math.max(0, f.promptT).toFixed(1) + 's');
        ($('.prompt-time i', form) as HTMLElement).style.width = (phase === 1 ? Math.max(0, f.promptT) / 5 * 100 : 100) + '%';
        ($('button', form) as HTMLButtonElement).disabled = phase === 2;
      }
      this.promptPhase[who] = phase;
    }
  }

  verdict(v: PromptVerdict): void {
    if (this.verdictTimer) clearTimeout(this.verdictTimer);
    this.verdictEl.hidden = false;
    this.verdictEl.innerHTML = v.ok
      ? `<span class="eyebrow">${escape(this.sheets[v.who].name)} WOVE A MANTRA</span><strong>${escape(v.name)}</strong><small>${v.kind === 'defense' ? 'DEFENSE · NO DAMAGE' : v.mode === 'lingering' ? 'ATTACK · DECAYING DAMAGE' : 'ATTACK · SINGLE EFFECT'} <b>−${v.cost} MANTRA</b></small>`
      : `<strong>The mantra faded</strong><small>${escape(v.reason ?? 'No clear intention was found.')}</small>`;
    this.verdictTimer = setTimeout(() => { this.verdictEl.hidden = true; }, 2800);
  }

  destroy(): void { if (this.verdictTimer) clearTimeout(this.verdictTimer); this.root.remove(); }
}
