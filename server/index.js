// Whot realtime server: serves the game surface and relays room actions.
// The same engine the browser plays with runs here, so rules never drift.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { createRoomManager, viewFor } from './rooms.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

// Only the game surface is public: index, styles, the js modules. Server
// sources, tests and dotfiles stay off the wire.
function serveStatic(req, res) {
  (async function () {
    const url = new URL(req.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (path === '/' || path === '/index.html') path = '/index.html';
    const allowed = path === '/index.html' ||
      path === '/style.css' ||
      /^\/js\/[a-z0-9-]+\.js$/.test(path);
    if (!allowed) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const file = join(ROOT, normalize(path));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[extname(path)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    }
  })();
}

function reply(ack, payload) {
  if (typeof ack === 'function') ack(payload);
}

export function startServer(opts) {
  opts = opts || {};
  const http = createServer(serveStatic);
  // The GitHub Pages build and the start.ng build load Socket.IO from here,
  // so both origins are allowed alongside local dev and this service itself.
  const io = new Server(http, {
    serveClient: true,
    cors: {
      origin: [
        'https://aphoe4x.github.io',
        'https://naija-whot.start.ng',
        'https://whot-okjn.onrender.com',
        /^http:\/\/localhost:\d+$/,
      ],
    },
  });
  const manager = createRoomManager({ rng: opts.rng });
  const seatSock = new Map(); // "CODE:seat" -> socket

  const key = function (code, seat) { return code + ':' + seat; };

  function eachSeat(room, fn) {
    for (const p of room.players) {
      const s = seatSock.get(key(room.code, p.seat));
      if (s) fn(s, p);
    }
  }

  function sendState(room, events) {
    eachSeat(room, function (s, p) {
      s.emit('state', { view: viewFor(room.state, p.seat), events: events || [] });
    });
  }

  function sendOpponent(room, exceptSeat, payload) {
    eachSeat(room, function (s, p) {
      if (p.seat !== exceptSeat) s.emit('opponent', payload);
    });
  }

  function bind(socket, room, player) {
    socket.data.code = room.code;
    socket.data.playerId = player.id;
    seatSock.set(key(room.code, player.seat), socket);
  }

  function current(socket) {
    const room = manager.get(socket.data.code);
    if (!room) return {};
    const player = room.players.find(function (p) { return p.id === socket.data.playerId; });
    if (!player) return {};
    return { room: room, player: player };
  }

  function ownsSeat(socket, room, player) {
    return seatSock.get(key(room.code, player.seat)) === socket;
  }

  io.on('connection', function (socket) {
    socket.on('create', function (payload, ack) {
      const body = payload || {};
      const made = manager.create(body.name, body.rules);
      bind(socket, made.room, made.player);
      reply(ack, { ok: true, code: made.room.code, playerId: made.player.id, seat: made.player.seat });
    });

    socket.on('join', function (payload, ack) {
      const res = manager.join(payload && payload.code, payload && payload.name);
      if (res.error) return reply(ack, res);
      bind(socket, res.room, res.player);
      reply(ack, { ok: true, code: res.room.code, playerId: res.player.id, seat: res.player.seat });
      sendState(res.room); // both seats get the fresh game
    });

    socket.on('resume', function (payload, ack) {
      const res = manager.resume(payload && payload.code, payload && payload.playerId);
      if (res.error) return reply(ack, res);
      bind(socket, res.room, res.player);
      reply(ack, { ok: true, seat: res.player.seat, hasState: !!res.room.state });
      sendOpponent(res.room, res.player.seat, { connected: true });
      if (res.room.state) sendState(res.room);
    });

    socket.on('action', function (action, ack) {
      const now = current(socket);
      if (!now.room || !now.player) return reply(ack, { error: 'Not in a room' });
      if (!ownsSeat(socket, now.room, now.player)) return reply(ack, { error: 'Session moved' });
      const res = manager.action(now.room, now.player, action);
      if (res.error) return reply(ack, res);
      reply(ack, { ok: true });
      sendState(now.room, res.events);
    });

    socket.on('nextRound', function (_payload, ack) {
      const now = current(socket);
      if (!now.room || !now.player) return reply(ack, { error: 'Not in a room' });
      if (!ownsSeat(socket, now.room, now.player)) return reply(ack, { error: 'Session moved' });
      const res = manager.nextRound(now.room);
      if (res.error) return reply(ack, res);
      reply(ack, { ok: true });
      sendState(now.room, ['New round. Place your cards.']);
    });

    socket.on('leave', function () {
      const now = current(socket);
      if (!now.room || !now.player) return;
      seatSock.delete(key(now.room.code, now.player.seat));
      manager.leave(now.room, now.player);
      socket.data.code = null;
      sendOpponent(now.room, now.player.seat, { connected: false });
    });

    socket.on('disconnect', function () {
      const now = current(socket);
      if (!now.room || !now.player) return;
      if (!ownsSeat(socket, now.room, now.player)) return;
      seatSock.delete(key(now.room.code, now.player.seat));
      manager.disconnect(now.room, now.player);
      sendOpponent(now.room, now.player.seat, { connected: false });
    });
  });

  return new Promise(function (resolve) {
    http.listen(opts.port == null ? 0 : opts.port, function () {
      resolve({
        http: http,
        io: io,
        port: http.address().port,
        close: function () {
          return new Promise(function (done) {
            io.close(function () { http.close(done); });
          });
        },
      });
    });
  });
}

const invokedAsMain = process.argv[1] &&
  fileURLToPath(import.meta.url).toLowerCase() === normalize(process.argv[1]).toLowerCase();
if (invokedAsMain) {
  const port = Number(process.env.PORT) || 3000;
  startServer({ port: port }).then(function (s) {
    console.log('Whot server: http://localhost:' + s.port);
  });
}
