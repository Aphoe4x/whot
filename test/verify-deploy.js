// Phase 3 deploy verification, run after Render gives us a URL.
// Usage: node verify-deploy.js https://whot-xxxx.onrender.com
import { io as connect } from 'socket.io-client';

const base = process.argv[2];
if (!base) {
  console.error('usage: node verify-deploy.js <render-url>');
  process.exit(1);
}

let failed = 0;
function ok(cond, msg) {
  console.log((cond ? '  PASS ' : '  FAIL ') + msg);
  if (!cond) failed++;
}

async function main() {
  console.log('verifying ' + base);

  const home = await fetch(base + '/');
  ok(home.status === 200, 'GET / serves the game (' + home.status + ')');

  const engine = await fetch(base + '/js/engine.js');
  ok(engine.status === 200, 'engine module served (' + engine.status + ')');

  const lobby = await home.text();
  ok(lobby.includes('lobbyModal'), 'lobby markup present');

  const leak = await fetch(base + '/server/rooms.js');
  ok(leak.status === 404, 'server source blocked (' + leak.status + ')');

  const sockJs = await fetch(base + '/socket.io/socket.io.js');
  ok(sockJs.status === 200, 'socket.io client served (' + sockJs.status + ')');

  // Real room round trip against the live public server.
  const url = new URL(base).origin;
  const opts = { reconnection: false, timeout: 10000 };
  const a = connect(url, opts);
  const b = connect(url, opts);

  const once = (sock, ev, ms) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout: ' + ev)), ms || 15000);
    sock.once(ev, (p) => { clearTimeout(timer); resolve(p); });
  });

  try {
    const aState = once(a, 'state', 20000);
    const bState = once(b, 'state', 20000);
    const created = await new Promise((res) => a.emit('create', 'Verifier', res));
    ok(created.ok && created.code, 'room created: ' + (created.code || JSON.stringify(created)));
    const joined = await new Promise((res) => b.emit('join', { code: created.code, name: 'Friend' }, res));
    ok(joined.ok, 'second player joined');
    const va = (await aState).view;
    const vb = (await bState).view;
    ok(va.players[0].name === 'Verifier', 'seat views delivered');
    ok(va.players[1].hand.every((c) => c === null), 'opponent hand hidden');
    a.close(); b.close();
  } catch (err) {
    ok(false, 'live room round trip: ' + err.message);
  }

  console.log(failed ? failed + ' FAILED' : 'all checks passed');
  setTimeout(() => process.exit(failed ? 1 : 0), 200);
}

main().catch((e) => { console.error(e); process.exit(1); });
