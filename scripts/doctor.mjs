import WebSocket from 'ws';

const args = process.argv.slice(2);
const at = args.indexOf('--url');
const base = (at >= 0 ? args[at + 1] : 'http://127.0.0.1:8787')?.replace(/\/$/, '');
if (!base || !/^https?:\/\//.test(base)) throw new Error('Usage: npm run doctor -- --url https://your-theatre.example [--online] [--ai]');
const json = async (route, body) => {
  const response = await fetch(base + '/api/' + route, {
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(route + ': HTTP ' + response.status);
  return response.json();
};

async function checkOnline() {
  const sessions = await Promise.all([json('session', {}), json('session', {})]);
  const url = base.replace(/^http/, 'ws') + '/ws';
  const sockets = [new WebSocket(url), new WebSocket(url)];
  const open = ws => new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  try {
    await Promise.all(sockets.map(open));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Online room did not start within 8 seconds.')), 8000);
      let starts = 0, joined = false;
      sockets.forEach((ws, i) => ws.on('message', raw => {
        try {
          const msg = JSON.parse(String(raw));
          if (msg.t === 'error') { clearTimeout(timer); reject(new Error(msg.message)); }
          if (i === 0 && msg.t === 'room' && !joined) {
            joined = true;
            sockets[1].send(JSON.stringify({ t: 'join', code: msg.code, player: { id: sessions[1].id, name: 'Doctor 2' }, token: sessions[1].token, pick: { id: 'thor', custom: false } }));
          }
          if (msg.t === 'start' && ++starts === 2) { clearTimeout(timer); resolve(); }
        } catch (error) { clearTimeout(timer); reject(error); }
      }));
      sockets[0].send(JSON.stringify({ t: 'create', player: { id: sessions[0].id, name: 'Doctor 1' }, token: sessions[0].token, pick: { id: 'arjuna', custom: false } }));
    });
    console.log('PASS WebSocket: invite, second player, authoritative match start');
  } finally { sockets.forEach(ws => ws.close()); }
}

try {
  const health = await json('health');
  if (!health.ok) throw new Error('Server reported unhealthy.');
  console.log('PASS server: v' + health.version + ', ' + health.store + ', ' + health.rooms + ' rooms');
  console.log('Providers: ' + (health.providers.join(', ') || 'none; local lore mode') + '. Memory: ' + (health.ai.memory ? 'configured' : 'off'));
  const page = await fetch(base, { signal: AbortSignal.timeout(8000) });
  if (!page.ok || !(await page.text()).includes('<title>Mythic Strings</title>')) throw new Error('The production client was not served.');
  const roster = await json('roster');
  if (roster.legends.length < 2) throw new Error('The roster is empty.');
  console.log('PASS client and roster: ' + roster.legends.length + ' built-in legends');
  if (args.includes('--ai') || !health.providers.length) {
    const read = await json('prompt', { text: 'dome of lightning' + (args.includes('--ai') ? ' ' + Date.now().toString(36) : ''), typedMs: 1200 });
    if (!read.ok || read.move.kind !== 'defense' || read.move.damage !== 0) throw new Error('Prompt classification failed.');
    console.log('PASS prompt: exclusive defense, zero damage (' + read.source + ', ' + read.ms + ' ms)');
    if (args.includes('--ai') && !['gemini', 'bedrock', 'memory', 'cache'].includes(read.source)) {
      throw new Error('The AI call fell back to local rules. Check provider keys, model access, allowances, and server logs.');
    }
  } else {
    console.log('SKIP paid AI probe: pass --ai to exercise the configured resolver.');
  }
  if (args.includes('--online')) await checkOnline();
  console.log('The theatre checks passed.');
} catch (error) {
  console.error('FAIL ' + error.message);
  process.exitCode = 1;
}
