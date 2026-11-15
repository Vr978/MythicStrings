import './styles.css';
import { rankName, winsToNextLevel } from '../shared/balance';
import { WEAPON_INFO } from '../shared/moves';
import type { ProgressUpdate, CharacterSheet } from '../shared/types';
import { STAT_KEYS, STAT_LABELS } from '../shared/types';
import { ROSTER } from '../shared/roster';
import type { ServerMsg } from '../shared/protocol';
import { api, establishSession, pickOf, playerProfile, save, sessionToken, type Health } from './api';
import { Sound } from './audio';
import { Duel, type DuelMode } from './duel';
import { Forge } from './forge';
import { Hud } from './hud';
import { Input } from './input';
import { OnlineRoom } from './online';
import { Scene } from './render/scene';
import { Stage } from './render/stage';
import { $, busy, escape, logo, ornament, text, toast } from './ui';

const player = playerProfile();
const sound = new Sound();
let health: Health | null = null;
let legends = [...ROSTER];
let customs: CharacterSheet[] = [];
let selected: [CharacterSheet, CharacterSheet] = [ROSTER[0], ROSTER.find(s => s.id === 'thor') ?? ROSTER[1]];
let view: 'home' | 'select' | 'forge' | 'lobby' | 'fight' = 'home';
let mode: DuelMode = 'cpu';
let side: 0 | 1 = 0;
let collection: 'legends' | 'customs' = 'legends';
let duel: Duel | null = null;
let hud: Hud | null = null;
let forge: Forge | null = null;
let room: OnlineRoom | null = null;
let resultShown = false;
let progress: ProgressUpdate[] = [];
let rematchReady: [boolean, boolean] = [false, false];
let opponentLeft = false;
let inviteCode = new URLSearchParams(location.search).get('join')?.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6) ?? '';

$('#app').innerHTML = `<header class="app-header">
  <button class="brand" id="brand" aria-label="Mythic Strings home">${logo}<span>MYTHIC <b>STRINGS</b><small>A SHADOW PLAY, REIMAGINED</small></span></button>
  <nav><span class="service-status" id="service-status">Lighting the lamp…</span><button class="text-button" id="how-to">How to play</button><button class="icon-button" id="sound-toggle" aria-label="Toggle music and sound" aria-pressed="${sound.enabled}">${sound.enabled ? '♫' : '♪'}</button><button class="icon-button" id="fullscreen" aria-label="Toggle fullscreen">⛶</button></nav>
</header>
<main id="theatre"><div id="stage-host" aria-hidden="true"></div><div class="stage-vignette"></div><div id="screen"><div class="boot-state">${logo}<p>Unfurling the screen…</p></div></div><div id="hud"></div><div id="result" hidden></div><button id="leave-duel" class="text-button" hidden>← Leave duel</button></main>
<footer class="app-footer"><span>THOLU BOMMALATA <b>·</b> ANDHRA PRADESH, INDIA</span><span>ANCIENT CRAFT. UNWRITTEN POSSIBILITIES.</span><span>SUNHACKS 9.0 ${ornament} 2026</span></footer>
<div id="toasts" aria-live="polite"></div>
<dialog id="help" aria-labelledby="help-title"><button class="icon-button close-dialog" aria-label="Close instructions">✕</button><span class="eyebrow">THE RULES OF THE THEATRE</span><h2 id="help-title">Every word has weight.</h2>
  <p>Two puppets. Two minutes. One unwritten legend. Reduce your rival to zero HP, or finish with more HP when time runs out.</p>
  <div class="help-grid"><div><h3>Move & strike</h3><p><kbd>W A S D</kbd> move, jump, duck<br><kbd>K</kbd> base · <kbd>L</kbd> special<br><kbd>Q</kbd> open a mantra</p></div><div><h3>A friend beside you</h3><p><kbd>↑ ← ↓ →</kbd> move, jump, duck<br><kbd>,</kbd> base · <kbd>.</kbd> special<br><kbd>Right Shift</kbd> open a mantra</p></div></div>
  <h3>Write your way out</h3><p>Opening a mantra slows the arena for both fighters. You have five real seconds to type an attack or defense, then press Enter. Your idea consumes mantra; its cost rises with power, length, and typing time. You can write again when the bar fully refills.</p>
  <h3>Shape your counter</h3><p>A wall blocks side attacks, a canopy blocks falling attacks, and a dome blocks both. Defenses never deal damage. Jump over ground waves, duck under beams, and move away from falling strikes.</p>
  <p>Visual effects last up to two arena seconds. Lingering damage spends the same total budget in three decaying ticks. The two-minute clock keeps running at normal speed.</p>
  <p class="field-note">Custom puppets start at 60 HP and gain a rank every three wins against another human, up to rank 10 and 100 HP. Practice earns no progression. Legends keep their fixed ratings. Two connected keyboards share the browser's keyboard input; local typing uses the focused text box.</p>
  <button class="btn full close-help">Light the lamp ↗</button>
</dialog>`;

const screen = $('#screen');
const resultHost = $('#result');
const help = $('#help') as HTMLDialogElement;
$('#how-to').addEventListener('click', () => help.showModal());
for (const close of help.querySelectorAll('.close-dialog, .close-help')) close.addEventListener('click', () => help.close());
help.addEventListener('click', e => { if (e.target === help) help.close(); });
$('#sound-toggle').addEventListener('click', () => {
  const enabled = sound.toggle();
  $('#sound-toggle').textContent = enabled ? '♫' : '♪';
  $('#sound-toggle').setAttribute('aria-pressed', String(enabled));
});
$('#fullscreen').addEventListener('click', () => {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else void document.documentElement.requestFullscreen().catch(() => toast('Fullscreen is unavailable in this browser.'));
});
const input = new Input(who => duel?.open(mode === 'online' ? duel.you : who), () => help.showModal());
document.addEventListener('pointerdown', () => sound.unlock(), { once: true });
document.addEventListener('keydown', () => sound.unlock(), { once: true });

let scene: Scene;

function cleanup(): void {
  duel?.stop(); duel = null;
  hud?.destroy(); hud = null;
  forge?.destroy(); forge = null;
  room?.close(); room = null;
  opponentLeft = false;
  resultHost.hidden = true;
  resultHost.innerHTML = '';
  $('#leave-duel').hidden = true;
}

function home(): void {
  cleanup();
  view = 'home';
  document.body.dataset.view = view;
  scene.show([ROSTER[0], ROSTER.find(s => s.id === 'thor') ?? ROSTER[1]], 'home');
  screen.innerHTML = `<section class="screen home-screen">
    <div class="hero-copy"><div class="hero-kicker"><span class="fine-line"></span><span>THE WORLD IS A SHADOW PLAY</span></div>
    <h1>Old legends.<br><em>New strings.</em></h1><p class="hero-description">An ancient art. A battle without a script.<br>Become a legend, and wield the power<br>of whatever you can imagine.</p>
    <div class="home-actions"><button class="btn hero-button" data-play="cpu">Enter the theatre <span>↗</span></button><div class="secondary-actions"><button class="btn secondary" data-play="local">Local duel <small>2 PLAYERS</small></button><button class="btn secondary" data-play="online">Play online <small>INVITE A FRIEND</small></button></div></div>
    <button class="forge-link text-button" data-forge>✦ &nbsp; Forge your own character <span>→</span></button>
    <div class="hero-facts"><div><strong>02</strong><span>PLAYERS</span></div><i></i><div><strong>120</strong><span>SECONDS</span></div><i></i><div><strong>∞</strong><span>POSSIBILITIES</span></div></div></div>
    <div class="stage-caption"><span class="eyebrow">LEATHER. LIGHT. LEGEND.</span><p>Every mythology.<br>One timeless craft.</p><span class="caption-rule"></span><small>A tribute to the shadow puppeteers<br>of Tholu Bommalata.</small></div>
    <div class="home-stage-label"><span>ARJUNA</span>${ornament}<span>THOR</span></div>
  </section>`;
  for (const button of screen.querySelectorAll<HTMLButtonElement>('[data-play]')) button.addEventListener('click', () => choose(button.dataset.play as DuelMode));
  $('[data-forge]', screen).addEventListener('click', () => openForge(null));
}

function choose(next: DuelMode): void {
  cleanup();
  mode = next; view = 'select'; side = 0;
  document.body.dataset.view = view;
  renderSelection();
}

function sheetMarkup(sheet: CharacterSheet, who: 0 | 1): string {
  const active = side === who;
  return `<article class="choice-sheet ${active ? 'active' : ''}" data-side="${who}">
    <button class="seat-label text-button" data-seat="${who}">${mode === 'online' ? 'YOUR PUPPET' : who === 0 ? 'PLAYER ONE' : mode === 'cpu' ? 'PRACTICE PARTNER' : 'PLAYER TWO'} ${active ? '◆' : '◇'}</button>
    <div class="sheet-title"><div><span class="eyebrow">${escape(sheet.origin)}</span><h2>${escape(sheet.name)}</h2><p>${escape(sheet.title)}</p></div><div class="rating-seal">${sheet.rating}<small>HP</small></div></div>
    <p class="sheet-lore">${escape(sheet.lore)}</p>
    <div class="stat-grid">${STAT_KEYS.map(k => `<div><span>${STAT_LABELS[k]}</span><b>${sheet.stats[k]}</b><i style="--stat:${sheet.stats[k]}%"></i></div>`).join('')}</div>
    <div class="sheet-moves">${[sheet.moves.base, sheet.moves.special].map((m, i) => `<div><small>${i ? 'SPECIAL' : 'BASE'} / ${escape(WEAPON_INFO[sheet.weapon].label)}</small><strong>${escape(m.name)}</strong><span>${m.cost} stamina · ${m.cooldown}s cooldown</span></div>`).join('')}</div>
    <div class="sheet-source">${sheet.kind === 'custom' ? 'RANK ' + sheet.level + ' · ' + rankName(sheet.level ?? 1) + ' · ' + (sheet.wins ?? 0) + ' WINS' : sheet.source === 'heuristic' ? 'LOCAL INTERPRETATION · CONNECT AI FOR RESEARCH' : sheet.source === 'ai' ? 'RESEARCHED LEGEND · FIXED RATING' : 'CURATED LEGEND · FIXED RATING'}</div>
    ${sheet.citations?.length ? '<div class="citations">' + sheet.citations.slice(0, 3).filter(c => /^https?:\/\//.test(c.url)).map(c => `<a href="${escape(c.url)}" target="_blank" rel="noopener noreferrer">${escape(c.title)} ↗</a>`).join('') + '</div>' : ''}
    ${sheet.kind === 'custom' ? '<div class="custom-actions"><button class="text-button" data-edit="' + who + '">Edit puppet ↗</button><button class="text-button danger" data-delete="' + who + '">Delete</button></div>' : ''}
  </article>`;
}

function renderSelection(): void {
  if (view !== 'select') return;
  scene.show(selected, 'select');
  const items = collection === 'legends' ? legends : customs;
  screen.innerHTML = `<section class="screen selection-screen">
    <div class="selection-heading"><button class="text-button" data-back>← The theatre</button><div><span class="eyebrow">${mode === 'cpu' ? 'SOLO PRACTICE' : mode === 'local' ? 'SIDE BY SIDE' : 'ACROSS THE WORLD'}</span><h1>Choose your legend.</h1></div><button class="btn secondary small" data-forge>✦ Forge a puppet</button></div>
    <div class="selection-layout">
      ${sheetMarkup(selected[0], 0)}
      <div class="roster-panel panel">
        <div class="roster-tabs"><button class="${collection === 'legends' ? 'active' : ''}" data-collection="legends">Legends <small>${legends.length}</small></button><button class="${collection === 'customs' ? 'active' : ''}" data-collection="customs">Your creations <small>${customs.length}</small></button></div>
        <input type="search" data-search aria-label="Search characters" placeholder="Find a legend or tradition…" autocomplete="off">
        <p class="pick-instruction">${mode === 'online' ? 'CHOOSE YOUR FIGHTER' : 'CHOOSING FOR ' + (side === 0 ? 'PLAYER ONE' : mode === 'cpu' ? 'PRACTICE PARTNER' : 'PLAYER TWO')}</p>
        <div class="roster-grid">${items.map(s => `<button class="character-card ${selected[side].id === s.id ? 'selected' : ''}" data-character="${escape(s.id)}" data-searchable="${escape((s.name + ' ' + s.origin + ' ' + s.weapon).toLowerCase())}" aria-pressed="${selected[side].id === s.id}">
          <span class="character-monogram" style="--dye:${s.look.primary}">${escape(s.name.slice(0, 1))}<i></i></span><strong>${escape(s.name)}</strong><small>${escape(s.origin)}</small><b>${s.rating} <span>HP</span></b></button>`).join('')}</div>
        ${items.length === 0 ? '<p class="empty-state">Your story starts with a blank piece of leather.<br>Forge your first puppet to begin.</p>' : ''}
        <form class="summon-form"><label for="summon-name">A legend missing from the stage?</label><div><input id="summon-name" name="legend" maxlength="40" minlength="2" required placeholder="Name a myth or legend" autocomplete="off"><button class="btn small" type="submit">Summon ↗</button></div><small>The first researched sheet is kept for every future duel.</small></form>
      </div>
      ${mode === 'online' ? `<article class="choice-sheet invite-sheet"><span class="eyebrow">THE OTHER SIDE OF THE SCREEN</span><h2>Call a challenger.</h2><p>Create a private duel and send your friend its code, or join theirs. Two seats. No audience. Just your wits.</p><label>Your name<input data-player-name maxlength="20" value="${escape(player.name)}" autocomplete="nickname"></label><button class="btn full" data-host>Create invite ↗</button><div class="divider"><span>OR JOIN A FRIEND</span></div><form data-join><label>Invite code<input name="code" maxlength="6" minlength="5" value="${escape(inviteCode)}" placeholder="ABCDE" required pattern="[A-Za-z2-9]{5,6}" autocomplete="off" class="code-input"></label><button class="btn secondary full" type="submit">Join duel →</button></form><small class="field-note">Use W A S D or arrow keys, K, L, and Q on your own device.</small></article>` : sheetMarkup(selected[1], 1)}
    </div>
    ${mode === 'online' ? '' : `<div class="selection-footer"><span>${mode === 'local' ? '<kbd>WASD</kbd> + <kbd>K L Q</kbd> &nbsp; / &nbsp; <kbd>ARROWS</kbd> + <kbd>, . R⇧</kbd>' : 'A sparring partner to learn the craft. Practice does not award wins.'}</span><button class="btn" data-start>Light the lamp <span>↗</span></button></div>`}
  </section>`;
  $('[data-back]', screen).addEventListener('click', home);
  $('[data-forge]', screen).addEventListener('click', () => openForge(null));
  for (const button of screen.querySelectorAll<HTMLButtonElement>('[data-seat]')) button.addEventListener('click', () => { side = Number(button.dataset.seat) as 0 | 1; renderSelection(); });
  for (const button of screen.querySelectorAll<HTMLButtonElement>('[data-collection]')) button.addEventListener('click', () => { collection = button.dataset.collection as typeof collection; renderSelection(); });
  for (const button of screen.querySelectorAll<HTMLButtonElement>('[data-character]')) button.addEventListener('click', () => {
    const sheet = [...legends, ...customs].find(s => s.id === button.dataset.character);
    if (sheet) { selected[side] = sheet; renderSelection(); }
  });
  ($('[data-search]', screen) as HTMLInputElement).addEventListener('input', e => {
    const query = (e.target as HTMLInputElement).value.toLowerCase().trim();
    for (const card of screen.querySelectorAll<HTMLElement>('[data-searchable]')) card.hidden = !card.dataset.searchable?.includes(query);
  });
  const summon = $('.summon-form', screen) as HTMLFormElement;
  summon.addEventListener('submit', e => { e.preventDefault(); void busy($('button', summon) as HTMLButtonElement, async () => {
    const name = ($('input', summon) as HTMLInputElement).value.trim();
    const { sheet } = await api.summon(name);
    if (!legends.some(s => s.id === sheet.id)) legends.push(sheet);
    selected[side] = sheet; collection = 'legends'; renderSelection();
    toast(sheet.source === 'heuristic' ? 'A local interpretation is ready. Add an AI key for researched appearance and sources.' : sheet.name + ' has entered the theatre.');
  }, 'Summoning…'); });
  for (const button of screen.querySelectorAll<HTMLButtonElement>('[data-edit]')) button.addEventListener('click', () => openForge(selected[Number(button.dataset.edit)]));
  for (const button of screen.querySelectorAll<HTMLButtonElement>('[data-delete]')) button.addEventListener('click', () => void busy(button, async () => {
    const s = selected[Number(button.dataset.delete)];
    await api.delete(player.id, s.id);
    customs = customs.filter(c => c.id !== s.id);
    selected = selected.map(c => c.id === s.id ? ROSTER[0] : c) as typeof selected;
    renderSelection(); toast(s.name + ' was removed from your collection.');
  }, 'Deleting…'));
  if (mode === 'online') {
    const updateName = () => { player.name = ($('[data-player-name]', screen) as HTMLInputElement).value.trim().slice(0, 20) || 'Puppeteer'; save('player', player); };
    $('[data-host]', screen).addEventListener('click', e => void busy(e.currentTarget as HTMLButtonElement, async () => { updateName(); await connect('create'); }, 'Creating…'));
    ($('[data-join]', screen) as HTMLFormElement).addEventListener('submit', e => { e.preventDefault(); const form = e.currentTarget as HTMLFormElement; void busy($('button', form) as HTMLButtonElement, async () => {
      updateName(); inviteCode = ($('input', form) as HTMLInputElement).value.toUpperCase().trim(); await connect('join');
    }, 'Joining…'); });
  } else $('[data-start]', screen).addEventListener('click', () => startDuel(selected, mode, 0));
}

function openForge(existing: CharacterSheet | null): void {
  cleanup(); view = 'forge';
  document.body.dataset.view = view;
  forge = new Forge(screen, player.id, existing, sheet => scene.show([sheet], 'forge'), sheet => {
    customs = [sheet, ...customs.filter(c => c.id !== sheet.id)];
    selected[0] = sheet; collection = 'customs';
    choose(mode); toast(sheet.name + ' is ready for the stage.');
  }, () => choose(mode));
}

async function connect(action: 'create' | 'join'): Promise<void> {
  await establishSession(player);
  room?.close();
  const connection = room = new OnlineRoom();
  connection.onMessage = message => { if (room === connection) onRoomMessage(message); };
  connection.onDisconnect = () => {
    if (room !== connection) return;
    input.reset(); opponentLeft = true;
    if (duel && duel.state.phase !== 'over') {
      duel.stop();
      resultHost.hidden = false;
      resultHost.innerHTML = '<div class="result-card panel"><span class="eyebrow">CONNECTION CLOSED</span><h1>The string broke.</h1><p>The connection to the duel server was lost.</p><button class="btn" data-home>Return to theatre ↗</button></div>';
      $('[data-home]', resultHost).addEventListener('click', home);
    } else { toast('The connection closed. Create a new invite to play again.'); if (view === 'lobby') choose('online'); }
  };
  try { await connection.connect(action === 'create' ? { t: 'create', player, token: sessionToken(), pick: pickOf(selected[0]) } : { t: 'join', code: inviteCode, player, token: sessionToken(), pick: pickOf(selected[0]) }); }
  catch (error) { connection.close(); if (room === connection) room = null; throw error; }
}

function onRoomMessage(message: ServerMsg): void {
  switch (message.t) {
    case 'room': {
      view = 'lobby'; document.body.dataset.view = view;
      inviteCode = message.code;
      const link = new URL(location.href); link.search = ''; link.searchParams.set('join', message.code);
      screen.innerHTML = `<section class="screen lobby-screen"><div class="lobby-card panel"><span class="eyebrow">A PRIVATE SHADOW PLAY</span><h1>${message.players[1] ? 'The challenger arrives.' : 'Leave a string for a friend.'}</h1><p>Share this code. Your duel begins when both seats are filled.</p><div class="invite-code">${escape(message.code)}</div><button class="btn secondary" data-copy>Copy invite link ↗</button><div class="lobby-seats">${message.players.map((p, i) => `<div class="${p ? 'joined' : ''}"><span>${p ? '◆' : '◇'}</span><strong>${p ? escape(p.name) : 'Waiting for a friend…'}</strong><small>${p ? escape(p.character) + ' · ' + p.rating + ' HP' : 'The second seat is open'}</small></div>`).join('')}</div><button class="text-button" data-back>← Cancel invite</button></div></section>`;
      $('[data-copy]', screen).addEventListener('click', () => {
        void navigator.clipboard.writeText(link.href).then(() => toast('Invite link copied.')).catch(() => toast('Share code ' + message.code + ' with your friend.'));
      });
      $('[data-back]', screen).addEventListener('click', () => choose('online'));
      break;
    }
    case 'start': startDuel(message.sheets, 'online', message.you); break;
    case 's': duel?.snapshot(message.s, message.ev); break;
    case 'verdict': hud?.verdict(message.v); break;
    case 'end': progress = message.progress; updateProgress(progress); if (duel?.state.phase === 'over') showResult(); break;
    case 'rematch':
      rematchReady = message.ready;
      if (!resultHost.hidden) updateRematch();
      break;
    case 'left':
      opponentLeft = true;
      if (duel) {
        if (duel.state.phase !== 'over') {
          duel.state.phase = 'over'; duel.state.winner = duel.you; duel.state.reason = 'forfeit';
        }
        showResult();
        updateRematch();
      } else { toast('Your challenger left. Create a new invite.'); choose('online'); }
      break;
    case 'error': toast(message.message); break;
  }
}

function startDuel(sheets: [CharacterSheet, CharacterSheet], nextMode: DuelMode, you: 0 | 1): void {
  duel?.stop(); hud?.destroy();
  mode = nextMode; view = 'fight'; resultShown = false; progress = []; rematchReady = [false, false]; opponentLeft = false;
  selected = sheets;
  document.body.dataset.view = view;
  screen.innerHTML = '';
  resultHost.hidden = true;
  resultHost.innerHTML = '';
  $('#leave-duel').hidden = false;
  scene.show(sheets, 'fight');
  const current = duel = new Duel(sheets, mode, you, input, player, {
    events: events => { scene.events(events); events.forEach(e => sound.event(e)); },
    verdict: verdict => hud?.verdict(verdict),
    text: who => hud?.text(who) ?? '',
    result: (updates, error) => { progress = updates; updateProgress(updates); if (error) toast(error); if (current === duel && duel.state.phase === 'over') showResult(); },
  }, room);
  hud = new Hud($('#hud'), sheets, mode, you, input, {
    open: who => current.open(who), submit: who => { void current.submit(who); }, cancel: who => current.cancel(who),
  });
  sound.unlock();
  void api.narrate(player.id, sheets).then(({ line }) => { if (duel === current && current.state.phase === 'intro') toast(line); }).catch(() => {});
}

function updateProgress(updates: ProgressUpdate[]): void {
  for (const p of updates) {
    const index = customs.findIndex(s => s.id === p.characterId);
    if (index >= 0) {
      const sheet = customs[index];
      customs[index] = { ...sheet, wins: p.wins, level: p.level, rating: p.rating, title: rankName(p.level), stats: Object.fromEntries(STAT_KEYS.map(k => [k, p.rating])) as CharacterSheet['stats'] };
    }
  }
}

function showResult(): void {
  if (!duel || duel.state.phase !== 'over') return;
  resultShown = true;
  const { state, sheets } = duel;
  const winner = state.winner;
  const update = progress[0];
  resultHost.hidden = false;
  resultHost.innerHTML = `<div class="result-card panel"><div class="result-ornament">${logo}</div><span class="eyebrow">${state.reason === 'time' ? 'THE LAST GRAIN FALLS' : state.reason === 'forfeit' ? 'THE CHALLENGER WITHDRAWS' : 'THE CURTAIN FALLS'}</span><h1>${winner === 2 ? 'An equal legend.' : escape(sheets[winner === 1 ? 1 : 0].name) + ' prevails.'}</h1><p>${winner === 2 ? 'Two stories, still unfinished.' : escape(sheets[winner === 1 ? 1 : 0].title)}</p>
    <div class="result-scores">${sheets.map((s, i) => `<div><span>${escape(s.name)}</span><strong>${Math.ceil(state.fighters[i].hp)} <small>HP</small></strong><small>${Math.round(state.fighters[i].dealt)} DAMAGE · ${state.fighters[i].prompts} MANTRAS</small></div>`).join('')} </div>
    ${update ? `<div class="progress-card"><span>${update.leveledUp ? '✦ A NEW RANK' : 'ANOTHER THREAD IN YOUR LEGEND'}</span><strong>Rank ${update.level} · ${rankName(update.level)} · ${update.rating} HP</strong><small>${update.wins} wins${winsToNextLevel(update.wins) ? ' · ' + winsToNextLevel(update.wins) + ' to your next rank' : ' · Highest rank reached'}</small></div>` : mode === 'cpu' ? '<small class="field-note">Practice does not award wins or ranks.</small>' : ''}
    <div class="result-actions"><button class="btn" data-rematch>Play again ↗</button><button class="btn secondary" data-select>Choose characters</button></div><button class="text-button" data-home>Return to the theatre</button><small class="rematch-note"></small></div>`;
  $('[data-home]', resultHost).addEventListener('click', home);
  $('[data-select]', resultHost).addEventListener('click', () => choose(mode));
  $('[data-rematch]', resultHost).addEventListener('click', event => {
    if (mode === 'online') { room?.send({ t: 'rematch' }); rematchReady[duel!.you] = true; updateRematch(); }
    else {
      const finished = duel;
      void busy(event.currentTarget as HTMLButtonElement, async () => {
        await finished?.resultReady();
        if (duel !== finished) return;
        const next = sheets.map(s => customs.find(c => c.id === s.id) ?? s) as typeof sheets;
        startDuel(next, mode, 0);
      }, 'Saving the duel…');
    }
  });
  updateRematch();
}

function updateRematch(): void {
  if (!duel || !resultShown || resultHost.hidden) return;
  const button = $('[data-rematch]', resultHost) as HTMLButtonElement;
  if (mode === 'online') {
    button.disabled = opponentLeft || rematchReady[duel.you];
    text(button, opponentLeft ? 'Challenger left' : rematchReady[duel.you] ? 'Waiting for challenger…' : 'Request rematch ↗');
    text($('.rematch-note', resultHost), opponentLeft ? 'Create a new invite to meet again.' : rematchReady[1 - duel.you] ? 'Your challenger is ready for a rematch.' : '');
  }
}

$('#brand').addEventListener('click', () => { if (scene) home(); });
$('#leave-duel').addEventListener('click', () => choose(mode));

async function refreshLibrary(): Promise<void> {
  try { await establishSession(player); } catch { text($('#service-status'), 'Server unavailable'); return; }
  const results = await Promise.allSettled([api.health(), api.roster(), api.characters(player.id)]);
  if (results[0].status === 'fulfilled') {
    health = results[0].value;
    text($('#service-status'), health.providers.length ? '✦ AI connected' : '✦ Local lore mode');
    $('#service-status').classList.add('connected');
  } else text($('#service-status'), 'Server unavailable');
  if (results[1].status === 'fulfilled') {
    const data = results[1].value;
    legends = [...new Map([...data.legends, ...data.summoned].map(s => [s.id, s])).values()];
  }
  if (results[2].status === 'fulfilled') customs = results[2].value.characters;
  if (view === 'select') renderSelection();
}

async function boot(): Promise<void> {
  try {
    scene = new Scene(await Stage.create($('#stage-host')));
    await refreshLibrary();
    home();
    if (inviteCode) choose('online');
    let last = performance.now();
    const frame = (now: number): void => {
      const dt = Math.max(0, (now - last) / 1000); last = now;
      if (duel) {
        duel.tick(dt);
        scene.setState(duel.state);
        hud?.update(duel.state);
        if (duel.state.phase === 'over' && !resultShown) showResult();
      }
      scene.update(Math.min(dt, 0.05));
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  } catch (error) {
    console.error(error);
    screen.innerHTML = '<div class="boot-state panel"><h1>The lamp needs a hand.</h1><p>The stage could not start. Enable WebGL in your browser and reload.</p><button class="btn" onclick="location.reload()">Try again ↗</button></div>';
  }
}

void boot();
