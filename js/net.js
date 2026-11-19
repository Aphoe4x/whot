// Realtime client. Loads the socket.io script the Node server serves and
// wraps it in a small promise API. On static hosting (GitHub Pages) there is
// no local server, so the client falls back to the deployed Render server
// and multiplayer works from any origin. Only if both are unreachable does
// createNet() reject and the lobby explains itself.
const REMOTE = 'https://whot-okjn.onrender.com';

export function createNet() {
  return new Promise(function (resolve, reject) {
    // Same origin first: works when the Node server or Docker container
    // serves the page. On GitHub Pages that script 404s, so load the
    // deployed Render server's client and connect to it cross-origin.
    loadScript('/socket.io/socket.io.js', function () {
      resolve(wrap(window.io({ reconnection: true })));
    }, function () {
      loadScript(REMOTE + '/socket.io/socket.io.js', function () {
        resolve(wrap(window.io(REMOTE, { reconnection: true })));
      }, function () {
        reject(new Error('no server'));
      });
    });
  });
}

function loadScript(src, onload, onerror) {
  const script = document.createElement('script');
  script.src = src;
  script.onload = onload;
  script.onerror = onerror;
  document.head.appendChild(script);
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
        resolve({ error: 'Server not reachable. Try again in a minute.' });
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
    create: function (name, rules) { return request('create', { name: name, rules: rules }); },
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
