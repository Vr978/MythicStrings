import { buildCustom, type ForgeInput } from '../shared/designer';
import { WEAPON_INFO } from '../shared/moves';
import { DEFAULT_LOOK } from '../shared/roster';
import {
  BOTTOMS, BUILDS, FACE_MARKS, FACIAL_HAIR, HAIR, HEADGEAR, SPECIES, STAGE_THEMES, TOPS, WEAPONS,
  type CharacterSheet, type PuppetLook, type Slot, type Weapon,
} from '../shared/types';
import { api } from './api';
import { $, busy, escape, label, toast } from './ui';

export class Forge {
  private look: PuppetLook;
  private weapon: Weapon;
  private baseId: string;
  private specialId: string;
  private name: string;
  private theme: string;
  private sketch: string | null = null;
  private active = true;

  constructor(
    private readonly host: HTMLElement,
    private readonly owner: string,
    private readonly existing: CharacterSheet | null,
    private readonly preview: (sheet: CharacterSheet) => void,
    private readonly onSave: (sheet: CharacterSheet) => void,
    private readonly onCancel: () => void,
  ) {
    this.look = structuredClone(existing?.look ?? { ...DEFAULT_LOOK, top: 'armor', headgear: 'kirita', jewelry: 1, primary: '#287c55', bottom: 'dhoti' });
    this.weapon = existing?.weapon ?? 'fists';
    this.baseId = existing?.moves.base.id ?? WEAPON_INFO[this.weapon].base[0].id;
    this.specialId = existing?.moves.special.id ?? WEAPON_INFO[this.weapon].special[0].id;
    this.name = existing?.name ?? '';
    this.theme = existing?.theme ?? 'temple';
    this.render();
    this.refresh();
  }

  private input(): ForgeInput {
    return { id: this.existing?.id, name: this.name || 'Your Legend', weapon: this.weapon, baseId: this.baseId, specialId: this.specialId, look: this.look, theme: this.theme };
  }

  private refresh(): void {
    if (this.active) this.preview(buildCustom(this.input(), this.owner, this.existing?.id ?? 'preview', this.existing?.wins ?? 0));
  }

  private select(key: string, title: string, values: readonly string[], value: string): string {
    return `<label>${escape(title)}<select aria-label="${escape(title)}" data-field="${key}">${values.map(v => `<option value="${v}" ${value === v ? 'selected' : ''}>${escape(label(v))}</option>`).join('')}</select></label>`;
  }

  private render(): void {
    const info = WEAPON_INFO[this.weapon];
    this.host.innerHTML = `<section class="screen forge-screen">
      <div class="forge-intro"><span class="eyebrow">THE PUPPET ATELIER</span><h1>A legend<br>of your making.</h1><p>Cut from leather.<br>Coloured by you.<br>Written in the arena.</p><div class="rank-badge">60 <small>STARTING HP</small></div></div>
      <form class="forge-panel panel">
        <div class="section-title"><div><span class="eyebrow">${this.existing ? 'REFINE YOUR PUPPET' : 'CREATE YOUR PUPPET'}</span><h2>The character forge</h2></div><button type="button" class="icon-button" data-cancel aria-label="Close forge">✕</button></div>
        <label>Character name<input name="name" value="${escape(this.name)}" maxlength="24" minlength="2" required placeholder="Give your legend a name" autocomplete="off"></label>
        <div class="form-section"><h3>01 <span>Cut & colour</span></h3>
          <div class="form-grid">
            ${this.select('species', 'Silhouette', SPECIES, this.look.species)}
            ${this.select('build', 'Build', BUILDS, this.look.build)}
            ${this.select('headgear', 'Headgear', HEADGEAR, this.look.headgear)}
            ${this.select('hair', 'Hair', HAIR, this.look.hair)}
            ${this.select('facialHair', 'Facial hair', FACIAL_HAIR, this.look.facialHair)}
            ${this.select('faceMark', 'Face marking', FACE_MARKS, this.look.faceMark)}
            ${this.select('top', 'Upper garment', TOPS, this.look.top)}
            ${this.select('bottom', 'Lower garment', BOTTOMS, this.look.bottom)}
            ${this.select('jewelry', 'Ornaments', ['0', '1', '2'], String(this.look.jewelry))}
            ${this.select('theme', 'Home stage', STAGE_THEMES, this.theme)}
          </div>
          <div class="palette">${(['skin', 'primary', 'secondary', 'accent', 'hairColor'] as const).map(key => `<label><input type="color" aria-label="${label(key)} colour" data-color="${key}" value="${this.look[key]}"><span>${key === 'hairColor' ? 'Hair' : label(key)}</span></label>`).join('')}</div>
          <div class="check-row"><label><input type="checkbox" data-cape ${this.look.cape ? 'checked' : ''}> Cape</label>${['tail', 'wings', 'halo', 'horns'].map(extra => `<label><input type="checkbox" data-extra="${extra}" ${this.look.extras.includes(extra as typeof this.look.extras[number]) ? 'checked' : ''}> ${label(extra)}</label>`).join('')}</div>
        </div>
        <div class="form-section"><h3>02 <span>Weapon & two moves</span></h3>
          ${this.select('weapon', 'Weapon', WEAPONS, this.weapon)}
          <p class="field-note">${escape(info.blurb)} Your two moves always belong to this weapon.</p>
          <div class="form-grid">${(['base', 'special'] as const).map(slot => `<label>${label(slot)} attack<select data-move="${slot}">${info[slot].map(m => `<option value="${m.id}" ${(slot === 'base' ? this.baseId : this.specialId) === m.id ? 'selected' : ''}>${escape(m.name)} · ${m.cost} stamina</option>`).join('')}</select></label>`).join('')}</div>
        </div>
        <div class="form-section atelier"><h3>03 <span>Ask the artisan</span><em>OPTIONAL</em></h3>
          <p class="field-note">Describe a new garment or weapon, bring your own sketch, or combine both. The artisan cuts a piece to fit your puppet.</p>
          <div class="form-grid"><label>Piece<select data-slot><option value="top">Upper garment</option><option value="bottom">Lower garment</option><option value="headgear">Headgear</option><option value="weapon">Weapon appearance</option></select></label>
          <label class="upload-label">Your sketch<input type="file" data-sketch accept="image/png,image/jpeg,image/webp"><span data-file-label>PNG / JPEG / WebP · up to 1 MB</span></label></div>
          <textarea data-description rows="2" maxlength="240" aria-label="Describe your custom piece" placeholder="Describe the silhouette, colour, and details…"></textarea>
          <button class="btn secondary full" type="button" data-craft>✦ Cut a custom piece</button>
          <div class="custom-pieces">${Object.entries(this.look.custom ?? {}).map(([slot, asset]) => `<div><span>✦ ${escape(asset?.name)} <small>${label(slot)}</small></span><button type="button" class="text-button" data-remove="${slot}">Remove</button></div>`).join('')}</div>
          <small class="field-note">Weapon artwork changes its appearance; your equipped weapon still sets its moves.</small>
        </div>
        <div class="forge-footer"><p>10 ranks · 3 wins per rank<br><small>Every new puppet starts equally at 60 HP.</small></p><button class="btn" type="submit">${this.existing ? 'Save changes' : 'Bring to life'} ↗</button></div>
      </form></section>`;
    $('[data-cancel]', this.host).addEventListener('click', this.onCancel);
    const form = $('form', this.host) as HTMLFormElement;
    ($('[name="name"]', this.host) as HTMLInputElement).addEventListener('input', e => { this.name = (e.target as HTMLInputElement).value; });
    form.addEventListener('submit', e => {
      e.preventDefault();
      void busy($('button[type="submit"]', form) as HTMLButtonElement, async () => {
        this.name = ($('[name="name"]', form) as HTMLInputElement).value.trim();
        if (this.name.length < 2) throw new Error('Give your puppet a name of at least two letters.');
        const { sheet } = await api.forge(this.owner, this.input());
        if (this.active) this.onSave(sheet);
      }, 'Bringing to life…');
    });
    for (const select of form.querySelectorAll<HTMLSelectElement>('[data-field]')) {
      select.addEventListener('change', () => {
        const key = select.dataset.field!;
        if (key === 'weapon') {
          this.weapon = select.value as Weapon;
          this.baseId = WEAPON_INFO[this.weapon].base[0].id;
          this.specialId = WEAPON_INFO[this.weapon].special[0].id;
          if (this.look.custom) delete this.look.custom.weapon;
          this.render();
        } else if (key === 'theme') this.theme = select.value;
        else {
          Object.assign(this.look, { [key]: key === 'jewelry' ? Number(select.value) : select.value });
          if (this.look.custom && ['top', 'bottom', 'headgear'].includes(key)) delete this.look.custom[key as Slot];
        }
        this.refresh();
      });
    }
    for (const select of form.querySelectorAll<HTMLSelectElement>('[data-move]')) {
      select.addEventListener('change', () => { if (select.dataset.move === 'base') this.baseId = select.value; else this.specialId = select.value; this.refresh(); });
    }
    for (const color of form.querySelectorAll<HTMLInputElement>('[data-color]')) color.addEventListener('input', () => { Object.assign(this.look, { [color.dataset.color!]: color.value }); this.refresh(); });
    ($('[data-cape]', form) as HTMLInputElement).addEventListener('change', e => { this.look.cape = (e.target as HTMLInputElement).checked; this.refresh(); });
    for (const check of form.querySelectorAll<HTMLInputElement>('[data-extra]')) check.addEventListener('change', () => {
      const extra = check.dataset.extra! as typeof this.look.extras[number];
      this.look.extras = check.checked ? [...this.look.extras, extra] : this.look.extras.filter(e => e !== extra);
      this.refresh();
    });
    for (const remove of form.querySelectorAll<HTMLButtonElement>('[data-remove]')) remove.addEventListener('click', () => {
      if (this.look.custom) delete this.look.custom[remove.dataset.remove as Slot];
      this.render(); this.refresh();
    });
    ($('[data-sketch]', form) as HTMLInputElement).addEventListener('change', async e => {
      const file = (e.target as HTMLInputElement).files?.[0];
      this.sketch = null;
      if (!file) return;
      if (file.size > 1_000_000 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { toast('Choose a PNG, JPEG, or WebP image under 1 MB.'); return; }
      this.sketch = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('That image could not be read.'));
        reader.readAsDataURL(file);
      }).catch(() => { toast('That image could not be read.'); return null; });
      if (this.active) $('[data-file-label]', form).textContent = file.name;
    });
    const craft = $('[data-craft]', form) as HTMLButtonElement;
    craft.addEventListener('click', () => void busy(craft, async () => {
      const slot = ($('[data-slot]', form) as HTMLSelectElement).value as Slot;
      const description = ($('[data-description]', form) as HTMLTextAreaElement).value.trim();
      if (!description && !this.sketch) throw new Error('Describe a piece or choose a sketch first.');
      const result = await api.atelier(slot, description, this.sketch, [this.look.primary, this.look.secondary, this.look.accent]);
      if (!this.active) return;
      (this.look.custom ??= {})[slot] = result.asset;
      this.render(); this.refresh();
      toast(result.source === 'builtin' ? 'A local pattern was cut. Configure an AI provider to interpret sketches and detailed designs.' : 'Your custom piece is ready to wear.');
    }, 'The artisan is cutting…'));
  }

  destroy(): void { this.active = false; }
}
