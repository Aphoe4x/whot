// Pure room and realtime game logic. No sockets, no DOM: the transport
// (server/index.js) owns connections, this owns the game.
import { createGame, applyAction, normaliseRules } from '../js/engine.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1

function makeCode(rng) {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  }
  return code;
}

function makeToken(rng) {
  let token = '';
  for (let i = 0; i < 24; i++) token += Math.floor(rng() * 16).toString(16);
  return token;
}

function cleanName(name, fallback) {
  const n = String(name || '').replace(/[^\w \-.]/g, '').trim().slice(0, 16);
  return n || fallback;
}

// Seat-safe view: the caller always sees themselves at index 0 holding their
// own hand. Opponent hand and market become counts, everything else is public.
export function viewFor(state, mySeat) {
  const swap = mySeat === 1;
  const at = function (i) { return swap ? 1 - i : i; };
  const players = [];
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i];
    players[at(i)] = {
      id: p.id,
      name: p.name,
      isAI: !!p.isAI,
      hand: i === mySeat ? p.hand.slice() : new Array(p.hand.length).fill(null),
    };
  }
  const scores = [];
  state.scores.forEach(function (s, i) { scores[at(i)] = s; });
  return {
    players: players,
    scores: scores,
    rules: state.rules,
    market: new Array(state.market.length).fill(null),
    pile: state.pile,
    callSuit: state.callSuit,
    turn: at(state.turn),
    phase: state.phase,
    pending: state.pending ? Object.assign({}, state.pending, { player: at(state.pending.player) }) : null,
    winner: state.winner == null ? null : at(state.winner),
  };
}

export function createRoomManager(opts) {
  opts = opts || {};
  const rng = opts.rng || Math.random;
  const now = opts.now || Date.now;
  const rooms = new Map();

  function get(code) {
    return rooms.get(String(code || '').trim().toUpperCase()) || null;
  }

  function start(room) {
    if (room.state || room.players.length < 2) return null;
    room.state = createGame({
      rng: rng,
      players: room.players.map(function (p) { return { id: p.id, name: p.name, isAI: false }; }),
      rules: room.rules,
    });
    return room.state;
  }

  function create(name, rules) {
    purge();
    let code = makeCode(rng);
    while (rooms.has(code)) code = makeCode(rng);
    const player = { id: makeToken(rng), name: cleanName(name, 'Player 1'), seat: 0, connected: true };
    const room = {
      code: code,
      players: [player],
      state: null,
      rules: normaliseRules(rules),
      createdAt: now(),
    };
    rooms.set(code, room);
    return { room: room, player: player };
  }

  function join(code, name) {
    const room = get(code);
    if (!room) return { error: 'Room not found' };
    if (room.players.length >= 2) return { error: 'Room is full' };
    if (room.state && room.state.phase !== 'ended') return { error: 'Game already in progress' };
    if (room.state) room.state = null; // stale round left by a player who left
    const player = { id: makeToken(rng), name: cleanName(name, 'Player 2'), seat: 1, connected: true };
    room.players.push(player);
    start(room);
    return { room: room, player: player };
  }

  function resume(code, playerId) {
    const room = get(code);
    if (!room) return { error: 'Room not found' };
    const player = room.players.find(function (p) { return p.id === playerId; });
    if (!player) return { error: 'Session expired' };
    player.connected = true;
    return { room: room, player: player };
  }

  function action(room, player, action) {
    const state = room.state;
    if (!state) return { error: 'Game has not started' };
    if (state.phase !== 'playing') return { error: 'Round is over' };
    if (state.turn !== player.seat) return { error: 'Not your turn' };
    const res = applyAction(state, action);
    if (!res.ok) return { error: res.reason };
    return { events: res.events };
  }

  function nextRound(room) {
    const state = room.state;
    if (!state || state.phase !== 'ended') return { error: 'Round is not over' };
    if (room.players.length < 2) return { error: 'Waiting for your opponent' };
    room.state = createGame({
      rng: rng,
      carryScores: state.scores,
      players: room.players.map(function (p) { return { id: p.id, name: p.name, isAI: false }; }),
      rules: room.rules,
    });
    return {};
  }

  function leave(room, player) {
    room.players = room.players.filter(function (p) { return p !== player; });
    if (room.players.length === 0) rooms.delete(room.code);
    return room;
  }

  function disconnect(room, player) {
    player.connected = false;
  }

  function opponent(room, player) {
    return room.players.find(function (p) { return p.seat !== player.seat; }) || null;
  }

  function purge(maxAgeMs) {
    const cutoff = now() - (maxAgeMs == null ? 30 * 60 * 1000 : maxAgeMs);
    for (const [code, room] of rooms) {
      const idle = room.players.every(function (p) { return !p.connected; });
      if (idle && room.createdAt < cutoff) rooms.delete(code);
    }
  }

  return {
    rooms: rooms,
    get: get,
    start: start,
    create: create,
    join: join,
    resume: resume,
    action: action,
    nextRound: nextRound,
    leave: leave,
    disconnect: disconnect,
    opponent: opponent,
    purge: purge,
  };
}
