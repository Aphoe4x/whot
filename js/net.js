// Realtime client. Loads the socket.io script the Node server serves and
// wraps it in a small promise API. On static hosting there is no server:
// createNet() rejects and the lobby explains itself.
export function createNet() {
  return new Promise(function (resolve, reject) {
    const start = function () { resolve(wrap(window.io({ reconnection: true }))); };
    if (window.io) return start();
    const script = document.createElement('script');
    script.src = '/socket.io/socket.io.js';
    script.onload = start;
    script.onerror = function () { reject(new Error('no server')); };
    document.head.appendChild(script);
  });
}

const TIMEOUT = 5000;

function wrap(socket) {
  const listeners = { state: [], opponent: [], resumeError: [] };
  let session = null;
  let resumeOnConnect = false;

  function request(event, payload) {
    return new Promise(function (resolve) {
      let done = false;
      const timer = setTimeout(function () {
        if (done) return;
        done = true;
        resolve({ error: 'Server not reachable' });
      }, TIMEOUT);
      socket.emit(event, payload, function (ack) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(ack || { error: 'No reply from server' });
      });
    });
  }

  socket.on('connect', function () {
    if (!session || !resumeOnConnect) return;
    resumeOnConnect = false;
    request('resume', session).then(function (ack) {
      if (ack && ack.error) {
        session = null;
        listeners.resumeError.forEach(function (fn) { fn(ack.error); });
      }
    });
  });
  socket.on('disconnect', function () {
    if (session) resumeOnConnect = true;
  });
  socket.on('state', function (payload) {
    listeners.state.forEach(function (fn) { fn(payload); });
  });
  socket.on('opponent', function (payload) {
    listeners.opponent.forEach(function (fn) { fn(payload); });
  });

  return {
    create: function (name) { return request('create', name); },
    join: function (code, name) { return request('join', { code: code, name: name }); },
    resume: function (code, playerId) { return request('resume', { code: code, playerId: playerId }); },
    action: function (action) { return request('action', action); },
    nextRound: function () { return request('nextRound', {}); },
    leave: function () {
      session = null;
      resumeOnConnect = false;
      socket.emit('leave');
    },
    setSession: function (s) {
      session = s;
      resumeOnConnect = false;
    },
    on: function (event, fn) {
      (listeners[event] || (listeners[event] = [])).push(fn);
    },
  };
}
