import type { SimEvent } from '../shared/sim';
import { readSaved, save } from './api';
import themeUrl from './assets/under-the-banyan-crown.mp3';

/**
 * The looping soundtrack ("Under the Banyan Crown") plus small synthesised percussion and chimes.
 * One toggle controls both. Music starts on the first user gesture, because browsers block autoplay.
 */
export class Sound {
  enabled = readSaved('sound', true);
  private context: AudioContext | null = null;
  private music: HTMLAudioElement | null = null;
  private lastHit = 0;

  unlock(): void {
    if (!this.enabled) return;
    try {
      this.context ??= new AudioContext();
      if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
    } catch { /* Audio is optional on devices that do not expose Web Audio. */ }
    this.playMusic();
  }

  private playMusic(): void {
    try {
      if (!this.music) {
        this.music = new Audio(themeUrl);
        this.music.loop = true;
        this.music.volume = 0.25;
      }
      if (this.music.paused) void this.music.play().catch(() => {});
    } catch { /* Music is optional on devices without HTML audio. */ }
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    save('sound', this.enabled);
    if (this.enabled) this.unlock();
    else this.music?.pause();
    return this.enabled;
  }

  private tone(hz: number, duration: number, volume: number, type: OscillatorType = 'sine', slide = 0.5): void {
    const c = this.context;
    if (!this.enabled || !c || c.state !== 'running') return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(hz, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, hz * slide), c.currentTime + duration);
    g.gain.setValueAtTime(volume, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + duration);
  }

  event(event: SimEvent): void {
    switch (event.type) {
      case 'start': this.tone(160, 0.6, 0.14, 'triangle'); break;
      case 'cast': this.tone(event.slot === 0 ? 380 : 620, 0.15, 0.035, 'triangle', 1.6); break;
      case 'hit':
        if (performance.now() - this.lastHit < 65 || event.dmg <= 0) break;
        this.lastHit = performance.now();
        this.tone(110, 0.12, 0.07, 'triangle', 0.3);
        break;
      case 'block': this.tone(1300, 0.12, 0.025, 'sine', 0.7); break;
      case 'prompt':
        if (event.phase === 'open') this.tone(740, 0.5, 0.045, 'sine', 0.5);
        break;
      case 'end': this.tone(220, 1, 0.07, 'triangle', event.winner === 2 ? 1 : 2); break;
    }
  }
}
