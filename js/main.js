// Wires the engine, the AI, the table and the realtime client together.
// Two modes share one table: "local" plays the computer (phase 1), "online"
// plays a friend through the Node server (phase 2).
import { createGame, applyAction } from './engine.js';
import { aiChoose } from './ai.js';
import * as ui from './ui.js';
import { createNet } from './net.js';

let state = null;   // local game vs the computer
let view = null;    // online game exactly as the server sent it
let mode = 'local';
let busy = false;
let net = null;
let session = null; // {code, playerId} kept for reconnect + refresh resume
let roundShown = false;

/* ---------- rendering ---------- */

function renderAll() {
  if (mode === 'online') renderOnline();
  else renderLocal();
}

function renderLocal() {
  const aiTurn = state.phase === 'playing' && state.players[state.turn].isAI;
  ui.render(state, { aiTurn: aiTurn, busy: busy, onPay: onPay });
}

function renderOnline() {
  if (!view) return;
  const mine = view.phase === 'playing' && view.turn === 0;
  ui.render(view, { aiTurn: view.phase === 'playing' && !mine, busy: false, onPay: onPay });
  if (view.phase === 'ended' && !roundShown) {
    roundShown = true;
    ui.showRound(view, function () {
      net.nextRound().then(function (ack) {
        if (ack && ack.error) ui.toast(ack.error);
      });
    });
  }
}

/* ---------- local: vs the computer (phase 1) ---------- */

function maybeAI() {
  if (state.phase !== 'playing') {
    ui.setThinking(false);
    ui.showRound(state, nextRound);
    return;
  }
  const current = state.players[state.turn];
  if (!current.isAI) {
    ui.setThinking(false);
    renderAll();
    return;
  }
  busy = true;
  ui.setThinking(true);
  renderAll();
  setTimeout(function () {
    const action = aiChoose(state);
    const res = applyAction(state, action);
    busy = false;
    ui.setThinking(false);
    if (res.ok) ui.addLog(res.events);
    else ui.toast(res.reason);
    renderAll();
    maybeAI();
  }, 650 + Math.random() * 550);
}

function humanAct(action) {
  if (busy || state.phase !== 'playing') return;
  if (state.players[state.turn].isAI) { ui.toast('Opponent is playing'); return; }
  const res = applyAction(state, action);
  if (!res.ok) { ui.toast(res.reason); return; }
  ui.addLog(res.events);
  renderAll();
  maybeAI();
}

function nextRound() {
  state = createGame({ carryScores: state.scores });
  ui.addLog(['New round. Place your cards.']);
  ui.hideModals();
  maybeAI();
}

function newGame() {
  state = createGame();
  ui.hideModals();
  ui.addLog(['Fresh table. Good luck.']);
  maybeAI();
}

/* ---------- online: realtime rooms (phase 2) ---------- */

function onlineAct(action) {
  if (!net) return;
  net.action(action).then(function (ack) {
    if (ack && ack.error) ui.toast(ack.error);
    // success pushes a fresh 'state' to both seats
  });
}

function onlinePlay(cardId, number) {
  if (!view || view.phase !== 'playing' || view.turn !== 0) {
    ui.toast(view && view.phase === 'playing' ? 'Not your turn' : 'Round is over');
    return;
  }
  if (number === 20) {
    ui.pickSuit().then(function (suit) {
      if (suit) onlineAct({ type: 'play', cardId: cardId, callSuit: suit });
    });
    return;
  }
  onlineAct({ type: 'play', cardId: cardId });
}

// The server logs real names so both seats read the same stream. From your
// own seat your name should read "You", matching the local table.
function asYou(events, myName) {
  if (!events || !events.length || !myName) return events || [];
  const rx = new RegExp('\\b' + myName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
  return events.map(function (e) { return e.replace(rx, 'You'); });
}

function onServerState(payload) {
  const next = payload && payload.view;
  if (!next) return;
  if (next.phase === 'playing') roundShown = false;
  const entering = mode !== 'online';
  if (entering) ui.clearLog(); // drop the local table's lines, start fresh
  if (payload.events && payload.events.length) {
    ui.addLog(asYou(payload.events, next.players[0] && next.players[0].name));
  }
  view = next;
  mode = 'online';
  ui.hideLobby();
  ui.setOnline(true);
  renderAll();
}

function saveSession(s) {
  session = s;
  const raw = JSON.stringify(s);
  try {
    // Per tab first: two windows of one browser are two different players,
    // and a shared key would let the second join steal the first seat.
    sessionStorage.setItem('whot.room', raw);
    localStorage.setItem('whot.room', raw); // fallback for a reopened tab
  } catch { /* private mode */ }
}

function clearSession() {
  session = null;
  try {
    sessionStorage.removeItem('whot.room');
    localStorage.removeItem('whot.room');
  } catch { /* private mode */ }
}

function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem('whot.room') || localStorage.getItem('whot.room'));
  } catch { return null; }
}

function ensureNet() {
  if (net) return Promise.resolve(net);
  return createNet().then(function (n) {
    net = n;
    net.on('state', onServerState);
    net.on('opponent', function (p) {
      ui.toast(p && p.connected ? 'Opponent reconnected' : 'Opponent disconnected');
    });
    net.on('resumeError', function (msg) {
      giveUpSession(msg || 'Session expired');
    });
    return net;
  });
}

function giveUpSession(msg) {
  clearSession();
  if (net) net.setSession(null);
  mode = 'local';
  view = null;
  roundShown = false;
  ui.setRoomCode(null);
  ui.setOnline(false);
  newGame();
  ui.showLobby(msg);
}

function createRoom() {
  ensureNet().then(function (n) {
    return n.create(ui.lobbyName());
  }).then(function (ack) {
    if (!ack || ack.error) { ui.lobbyError((ack && ack.error) || 'Could not create a room'); return; }
    saveSession({ code: ack.code, playerId: ack.playerId });
    net.setSession(session);
    ui.setRoomCode(ack.code);
    ui.showWaiting(ack.code);
  }).catch(function () {
    ui.lobbyError('Online play needs the server. Run npm start, then try again.');
  });
}

function joinRoom() {
  const code = ui.lobbyCode();
  if (code.length !== 6) { ui.lobbyError('Enter the 6 character room code'); return; }
  ensureNet().then(function (n) {
    return n.join(code, ui.lobbyName());
  }).then(function (ack) {
    if (!ack || ack.error) { ui.lobbyError((ack && ack.error) || 'Could not join'); return; }
    saveSession({ code: ack.code, playerId: ack.playerId });
    net.setSession(session);
    ui.setRoomCode(ack.code);
    // the server starts the game and pushes state to both seats
  }).catch(function () {
    ui.lobbyError('Online play needs the server. Run npm start, then try again.');
  });
}

function cancelWait() {
  if (net) { net.leave(); net.setSession(null); }
  clearSession();
  ui.setRoomCode(null);
  ui.showLobby();
}

function leaveRoom() {
  if (net) { net.leave(); net.setSession(null); }
  clearSession();
  ui.setRoomCode(null);
  ui.setOnline(false);
  mode = 'local';
  view = null;
  roundShown = false;
  newGame();
  ui.showLobby('You left the room');
}

/* ---------- input dispatch ---------- */

function onPlay(cardId, number) {
  if (mode === 'online') { onlinePlay(cardId, number); return; }
  if (busy || state.phase !== 'playing') return;
  if (state.players[state.turn].isAI) { ui.toast('Opponent is playing'); return; }
  if (number === 20) {
    ui.pickSuit().then(function (suit) {
      if (!suit) return;
      humanAct({ type: 'play', cardId: cardId, callSuit: suit });
    });
    return;
  }
  humanAct({ type: 'play', cardId: cardId });
}

function onDraw() {
  if (mode === 'online') {
    if (!view || view.phase !== 'playing' || view.turn !== 0) { ui.toast('Not your turn'); return; }
    onlineAct({ type: 'draw' });
    return;
  }
  humanAct({ type: 'draw' });
}

function onPay() {
  if (mode === 'online') {
    if (!view || view.turn !== 0) { ui.toast('Not your turn'); return; }
    onlineAct({ type: 'pay' });
    return;
  }
  humanAct({ type: 'pay' });
}

function onNew() {
  if (mode === 'online' || session) { leaveRoom(); return; }
  newGame();
}

function onLocal() {
  if (net && session) { net.leave(); net.setSession(null); }
  clearSession();
  ui.setRoomCode(null);
  ui.setOnline(false);
  if (mode === 'local') {
    // Already sitting at a local table: keep the game, just close the lobby.
    ui.hideLobby();
    return;
  }
  mode = 'local';
  view = null;
  roundShown = false;
  newGame();
  ui.hideLobby();
}

/* ---------- boot ---------- */

async function boot() {
  ui.init({
    onPlay: onPlay,
    onDraw: onDraw,
    onPay: onPay,
    onNew: onNew,
    onCreate: createRoom,
    onJoin: joinRoom,
    onLocal: onLocal,
    onCancelWait: cancelWait,
  });
  newGame();

  const saved = loadSession();
  if (saved && saved.code && saved.playerId) {
    try {
      const n = await ensureNet();
      const ack = await n.resume(saved.code, saved.playerId);
      if (ack && ack.error) {
        giveUpSession();
      } else {
        n.setSession(saved);
        saveSession(saved); // promote the fallback copy into this tab
        ui.setRoomCode(saved.code);
        if (!ack.hasState) ui.showWaiting(saved.code);
        // with a live game the server pushes state right after the ack
      }
    } catch {
      clearSession();
      ui.showLobby();
    }
  } else {
    ui.showLobby();
  }
}

boot();
