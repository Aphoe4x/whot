// Phase 2 gate: room manager unit tests + a live two-client socket test.
import { legalCards } from '../js/engine.js';
import { createRoomManager, viewFor } from '../server/rooms.js';
import { startServer } from '../server/index.js';
import { io as connect } from 'socket.io-client';

let passed = 0;
let failed = 0;

function ok(cond, msg) {
  if (cond) passed++;
  else { failed++; console.error('  FAIL: ' + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + ' (expected ' + b + ', got ' + a + ')'); }

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function once(sock, event, ms) {
  return new Promise(function (resolve, reject) {
    const timer = setTimeout(function () {
      reject(new Error('timeout waiting for "' + event + '"'));
    }, ms || 4000);
    sock.once(event, function (payload) {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

// ---------- 1. room manager units ----------

console.log('room manager');
{
  const mgr = createRoomManager({ rng: mulberry32(1) });

  const a = mgr.create('Ada');
  eq(a.player.seat, 0, 'creator takes seat 0');
  eq(a.room.code.length, 6, 'code is 6 chars');
  eq(a.room.code, a.room.code.toUpperCase(), 'code is uppercase');
  ok(!/[IO01]/.test(a.room.code), 'code avoids I, O, 0, 1');
  ok(!a.room.state, 'no game until opponent joins');

  const bad = mgr.join('XXXXXX', 'Bob');
  ok(bad.error, 'joining a missing room fails: ' + (bad.error || 'none'));

  const b = mgr.join(a.room.code, 'Bob');
  ok(!b.error, 'joining by code works: ' + (b.error || 'ok'));
  eq(b.player.seat, 1, 'joiner takes seat 1');
  ok(a.room.state, 'game auto-starts with two players');
  eq(a.room.state.players[0].hand.length, 6, 'engine dealt 6 to seat 0');

  const full = mgr.join(a.room.code, 'Eve');
  ok(full.error === 'Room is full', 'third join rejected: ' + (full.error || 'none'));

  // Views: each seat sees its own hand, the opponent only as a count.
  const view0 = viewFor(a.room.state, 0);
  const view1 = viewFor(a.room.state, 1);
  eq(view0.players[0].hand.length, 6, 'seat 0 sees own 6 cards');
  ok(view0.players[0].hand[0] && view0.players[0].hand[0].id, 'seat 0 hand has real cards');
  ok(view0.players[1].hand.every(function (c) { return c === null; }), 'seat 0 cannot see seat 1 hand');
  eq(view0.players[1].hand.length, 6, 'seat 0 still sees opponent count');
  ok(view1.players[0].hand[0] && view1.players[0].hand[0].id, 'seat 1 sees own real cards');
  ok(view1.players[1].hand.every(function (c) { return c === null; }), 'seat 1 cannot see seat 0 hand');
  ok(view0.market.every(function (c) { return c === null; }), 'market is count-only');
  eq(view0.turn, a.room.state.turn, 'seat 0 turn matches engine');
  eq(view1.turn, a.room.state.turn === 0 ? 1 : 0, 'seat 1 turn is remapped');

  // Turn enforcement: the wrong seat cannot act.
  const turnSeat = a.room.state.turn;
  const wrongSeat = turnSeat === 0 ? b.player : a.player;
  const blocked = mgr.action(a.room, wrongSeat, { type: 'draw' });
  ok(blocked.error === 'Not your turn', 'out-of-turn action rejected: ' + (blocked.error || 'none'));

  // The right seat can act, and the event stream comes back.
  const rightSeat = turnSeat === 0 ? a.player : b.player;
  const viewForActor = viewFor(a.room.state, rightSeat.seat);
  const legal = legalCards(viewForActor, 0);
  let act = { type: 'draw' };
  if (legal.length) {
    act = { type: 'play', cardId: legal[0].id };
    if (legal[0].number === 20) act.callSuit = 'stars';
  }
  const done = mgr.action(a.room, rightSeat, act);
  ok(!done.error, 'in-turn action accepted: ' + (done.error || 'ok'));
  ok(Array.isArray(done.events) && done.events.length > 0, 'action produced events');

  // Illegal card on the wrong terms is refused by the engine.
  const nextView = viewFor(a.room.state, a.room.state.turn);
  const nextLegal = legalCards(nextView, 0);
  const other = a.room.state.turn === 0 ? b.player : a.player;
  if (nextLegal.length === 0) {
    const shouldDraw = mgr.action(a.room, other, { type: 'play', cardId: 'not-in-hand' });
    ok(shouldDraw.error, 'unknown card rejected: ' + (shouldDraw.error || 'none'));
  }

  // nextRound only after the round actually ends, and scores carry.
  const early = mgr.nextRound(a.room);
  ok(early.error, 'next round refused while playing: ' + (early.error || 'none'));
  a.room.state.phase = 'ended';
  a.room.state.winner = 0;
  a.room.state.scores = [0, 39];
  const again = mgr.nextRound(a.room);
  ok(!again.error, 'next round accepted when ended: ' + (again.error || 'ok'));
  eq(a.room.state.phase, 'playing', 'fresh round is live');
  eq(a.room.state.scores[0], 0, 'score carried for seat 0');
  eq(a.room.state.scores[1], 39, 'score carried for seat 1');

  // Resume by token, reject strangers.
  const back = mgr.resume(a.room.code, b.player.id);
  ok(!back.error, 'original player resumes: ' + (back.error || 'ok'));
  const stranger = mgr.resume(a.room.code, 'deadbeef');
  ok(stranger.error === 'Session expired', 'stranger refused: ' + (stranger.error || 'none'));

  // Leave frees the seat and empties the room to deletion.
  mgr.leave(a.room, b.player);
  eq(a.room.players.length, 1, 'leaving frees the seat');
  mgr.leave(a.room, a.player);
  ok(!mgr.get(a.room.code), 'empty room deleted');
}

// ---------- 2. live two-client socket test ----------

console.log('live server');
{
  const srv = await startServer({ port: 0, rng: mulberry32(7) });
  const url = 'http://localhost:' + srv.port;
  const opts = { reconnection: false, timeout: 3000 };
  const a = connect(url, opts);
  const b = connect(url, opts);

  try {
    // Static surface: the game itself, and nothing from server/ or test/.
    const home = await fetch(url + '/');
    eq(home.status, 200, 'GET / serves the game');
    const engine = await fetch(url + '/js/engine.js');
    eq(engine.status, 200, 'engine module served');
    const leak1 = await fetch(url + '/server/index.js');
    eq(leak1.status, 404, 'server source not served');
    const leak2 = await fetch(url + '/test/engine.test.js');
    eq(leak2.status, 404, 'tests not served');

    // CORS: the GitHub Pages build handshakes cross-origin, strangers do not.
    const hs = '/socket.io/?EIO=4&transport=polling';
    const pages = await fetch(url + hs, { headers: { Origin: 'https://aphoe4x.github.io' } });
    eq(pages.headers.get('access-control-allow-origin'), 'https://aphoe4x.github.io',
       'Pages origin allowed by CORS');
    const stranger = await fetch(url + hs, { headers: { Origin: 'https://evil.example' } });
    eq(stranger.headers.get('access-control-allow-origin'), null, 'unknown origin not allowed');

    const aState = once(a, 'state');
    const bState = once(b, 'state');

    const created = await new Promise(function (res) { a.emit('create', 'Ada', res); });
    ok(created.ok && created.code, 'create acked with code: ' + JSON.stringify(created));
    const joined = await new Promise(function (res) {
      b.emit('join', { code: created.code, name: 'Tunde' }, res);
    });
    ok(joined.ok && joined.seat === 1, 'join acked: ' + JSON.stringify(joined));

    const viewA = (await aState).view;
    const viewB = (await bState).view;
    eq(viewA.players[0].name, 'Ada', 'A sees own name at seat 0');
    eq(viewB.players[0].name, 'Tunde', 'B sees own name at seat 0');
    eq(viewA.players[1].name, 'Tunde', 'A sees opponent name');
    ok(viewA.players[0].hand.every(function (c) { return c && c.id; }), 'A holds real cards');
    ok(viewA.players[1].hand.every(function (c) { return c === null; }), 'A cannot see B hand');

    // Out-of-turn action is refused with a reason.
    const turnIsA = viewA.turn === 0;
    const wrongClient = turnIsA ? b : a;
    const wrongAck = await new Promise(function (res) {
      wrongClient.emit('action', { type: 'draw' }, res);
    });
    ok(wrongAck.error === 'Not your turn', 'live out-of-turn refused: ' + (wrongAck.error || 'none'));

    // The seat to move plays a legal card (or draws), both sides get state.
    const actor = turnIsA ? a : b;
    const actorView = turnIsA ? viewA : viewB;
    const legal = legalCards(actorView, 0);
    const act = { type: 'draw' };
    if (legal.length) {
      act.type = 'play';
      act.cardId = legal[0].id;
      if (legal[0].number === 20) act.callSuit = 'crosses';
    }
    const nextA = once(a, 'state');
    const nextB = once(b, 'state');
    const playAck = await new Promise(function (res) { actor.emit('action', act, res); });
    ok(playAck.ok, 'live action accepted: ' + JSON.stringify(playAck));
    const afterA = await nextA;
    const afterB = await nextB;
    ok(afterA.events.length > 0, 'A received events: ' + JSON.stringify(afterA.events));
    eq(afterB.events.length, afterA.events.length, 'both seats get the same events');
    ok(afterA.view.turn !== actorView.turn || afterA.view.phase === 'ended',
       'turn advanced (or round ended)');

    // Disconnect: the opponent is told, then the seat resumes on a new socket.
    const lost = once(a, 'opponent');
    b.close();
    eq((await lost).connected, false, 'opponent disconnect announced');

    const c = connect(url, opts);
    const resumed = await new Promise(function (res) {
      c.emit('resume', { code: created.code, playerId: joined.playerId }, res);
    });
    ok(resumed.ok && resumed.hasState, 'resume on fresh socket: ' + JSON.stringify(resumed));
    const backView = (await once(c, 'state')).view;
    eq(backView.players[0].name, 'Tunde', 'resumed player gets their seat view back');
    // Seat is taken: a stranger with the same code cannot hijack it.
    const hijack = await new Promise(function (res) {
      const d = connect(url, opts);
      d.emit('resume', { code: created.code, playerId: 'nope' }, function (ack) {
        d.close();
        res(ack);
      });
    });
    ok(hijack.error, 'fake resume refused: ' + (hijack.error || 'none'));

    c.close();
    a.close();
  } catch (err) {
    failed++;
    console.error('  FAIL: live test threw: ' + err.message);
  } finally {
    await srv.close();
  }
}

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
// Let sockets and the http server finish closing before tearing the process
// down (a forced exit trips a libuv assertion on Windows).
setTimeout(function () { process.exit(failed > 0 ? 1 : 0); }, 150);
