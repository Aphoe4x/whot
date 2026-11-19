// Rendering and input for the Whot table.
import { SUITS, topOf, legalCards, SPECIAL_NAMES, RULE_CARDS, DEFENDABLE, normaliseRules, rulePillText } from './engine.js';

const $ = function (id) { return document.getElementById(id); };

const els = {};
const SETTINGS_KEY = 'whot.settings';
let settings = loadSettings();

function loadSettings() {
  const fallback = { hints: true, rules: normaliseRules() };
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (!raw) return fallback;
    return { hints: raw.hints !== false, rules: normaliseRules(raw.rules) };
  } catch { return fallback; }
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
}

export function getSettings() { return settings; }
const TAG_TEXT = { 1: 'Hold on', 2: 'Pick two', 5: 'Pick three', 8: 'Suspend', 14: 'Gen. market' };
const TAG_CLASS = { 1: 'gold', 2: 'hot', 5: 'hot', 8: '', 14: 'hot' };
const SUIT_ORDER = { circles: 0, triangles: 1, crosses: 2, squares: 3, stars: 4, whot: 5 };

const GLYPHS = {
  circles: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor"/></svg>',
  triangles: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 L21 20 L3 20 Z" fill="currentColor"/></svg>',
  crosses: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5 L19 19 M19 5 L5 19" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" fill="none"/></svg>',
  squares: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2.5" fill="currentColor"/></svg>',
  stars: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 L14.9 8.6 L22 9.3 L16.7 14.2 L18.2 21.2 L12 17.6 L5.8 21.2 L7.3 14.2 L2 9.3 L9.1 8.6 Z" fill="currentColor"/></svg>',
  whot: '<svg viewBox="0 0 100 44" aria-hidden="true"><text x="50" y="34" text-anchor="middle" font-size="34" font-weight="700" font-family="inherit" fill="currentColor">W!</text></svg>',
};

const logLines = [];
let suitResolve = null;
let toastTimer = null;
let onSuitPick = null;

export function glyph(suit) { return GLYPHS[suit] || GLYPHS.whot; }

function cardFace(card) {
  const el = document.createElement('div');
  const special = card.number !== 20 && SPECIAL_NAMES[card.number];
  el.className = 'card suit-' + card.suit;
  el.setAttribute('aria-label', card.number === 20 ? 'Whot card' : card.suit + ' ' + card.number);
  const cornerNum = card.number;
  const cornerGlyph = card.number === 20 ? GLYPHS.whot : GLYPHS[card.suit];
  el.innerHTML =
    '<span class="corner"><span>' + cornerNum + '</span><span class="mini">' + cornerGlyph + '</span></span>' +
    '<span class="glyph">' + GLYPHS[card.suit] + '</span>' +
    (special ? '<span class="tag ' + TAG_CLASS[card.number] + '">' + TAG_TEXT[card.number] + '</span>'
             : card.number === 20 ? '<span class="tag gold">Whot</span>' : '');
  return el;
}

export function render(state, ctx) {
  // scores
  els.scoreYou.textContent = state.scores[0];
  els.scoreFoe.textContent = state.scores[1];

  // opponent
  const foeHand = state.players[1];
  els.foeName.textContent = foeHand.name;
  els.foeCount.textContent = foeHand.hand.length + (foeHand.hand.length === 1 ? ' card' : ' cards');
  els.foeHand.innerHTML = '';
  const shown = Math.min(foeHand.hand.length, 8);
  for (let i = 0; i < shown; i++) {
    const b = document.createElement('div');
    b.className = 'card back';
    els.foeHand.appendChild(b);
  }

  // piles
  els.marketCount.textContent = state.market.length;
  const humanActive = state.phase === 'playing' && !ctx.aiTurn && !ctx.busy;
  els.market.disabled = !humanActive || !!state.pending;

  els.discard.innerHTML = '';
  const top = topOf(state);
  if (top) els.discard.appendChild(cardFace(top));

  // call pill: only relevant when a Whot is on top
  if (top && top.number === 20 && state.callSuit) {
    els.callPill.classList.remove('hidden');
    els.callPill.className = 'pill call';
    els.callPill.innerHTML = 'Call: ' + glyph(state.callSuit).replace('<svg', '<svg style="width:14px;height:14px;vertical-align:-2px"') + ' ' + state.callSuit;
  } else {
    els.callPill.classList.add('hidden');
  }

  // turn pill
  if (state.phase === 'ended') {
    els.turnPill.textContent = 'Round over';
    els.turnPill.className = 'pill';
  } else if (ctx.aiTurn) {
    els.turnPill.textContent = ctx.busy ? 'Opponent is thinking' : "Opponent's turn";
    els.turnPill.className = 'pill turn-foe';
  } else {
    els.turnPill.textContent = state.pending
      ? (state.rules && state.rules.defend.indexOf(state.pending.number) !== -1 ? 'Defend or pay' : 'Pay')
      : 'Your turn';
    els.turnPill.className = 'pill turn-your';
  }

  // pending prompt
  if (state.pending && state.pending.player === 0 && state.phase === 'playing') {
    els.prompt.classList.remove('hidden');
    const who = state.pending.number === 2 ? 'Pick two' : 'Pick three';
    const canDefend = state.rules && state.rules.defend.indexOf(state.pending.number) !== -1;
    els.prompt.innerHTML =
      '<span>' + state.players[1].name + ' played <b>' + who + '</b>.</span>' +
      '<button class="btn" type="button" id="btnPay">' + (canDefend
        ? 'Defend with a ' + state.pending.number + ' or pay ' + state.pending.amount
        : 'Pay ' + state.pending.amount) + '</button>';
    const pay = $('btnPay');
    if (pay && ctx.onPay) pay.addEventListener('click', ctx.onPay);
  } else {
    els.prompt.classList.add('hidden');
    els.prompt.innerHTML = '';
  }

  // your hand
  const mine = state.players[0];
  // Strict difficulty: no card is marked, so the player works out the
  // playable ones from the call card.
  const hint = ctx.hints !== false;
  const legal = hint && state.phase === 'playing' && humanActive ? legalCards(state, 0) : [];
  const legalIds = new Set(legal.map(function (c) { return c.id; }));
  const sorted = mine.hand.slice().sort(function (a, b) {
    return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit] || a.number - b.number;
  });
  els.myHand.innerHTML = '';
  els.myHand.classList.toggle('centered', sorted.length <= 4);
  for (const card of sorted) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'card suit-' + card.suit + (hint ? ' ' + (legalIds.has(card.id) ? 'legal' : 'illegal') : '');
    const special = card.number !== 20 && SPECIAL_NAMES[card.number];
    b.innerHTML =
      '<span class="corner"><span>' + card.number + '</span><span class="mini">' + GLYPHS[card.suit] + '</span></span>' +
      '<span class="glyph">' + GLYPHS[card.suit] + '</span>' +
      (special ? '<span class="tag ' + TAG_CLASS[card.number] + '">' + TAG_TEXT[card.number] + '</span>'
               : card.number === 20 ? '<span class="tag gold">Whot</span>' : '');
    b.setAttribute('aria-label', (card.number === 20 ? 'Whot card' : card.suit + ' ' + card.number) + (hint && legalIds.has(card.id) ? ', playable' : ''));
    b.dataset.id = card.id;
    b.dataset.num = String(card.number);
    els.myHand.appendChild(b);
  }

  renderLog();
}

function renderLog() {
  els.log.innerHTML = '';
  logLines.slice(0, 3).forEach(function (line) {
    const d = document.createElement('div');
    d.textContent = line;
    els.log.appendChild(d);
  });
}

export function addLog(events) {
  for (const e of events) {
    logLines.unshift(e);
  }
  if (logLines.length > 12) logLines.length = 12;
  renderLog();
}

export function clearLog() {
  logLines.length = 0;
  renderLog();
}

export function toast(msg) {
  if (!msg) return;
  els.toast.textContent = msg;
  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { els.toast.classList.add('hidden'); }, 2000);
}

export function setThinking(on) {
  els.think.classList.toggle('hidden', !on);
}

export function pickSuit() {
  return new Promise(function (resolve) {
    suitResolve = resolve;
    els.suitModal.classList.remove('hidden');
  });
}

function closeSuit(suit) {
  els.suitModal.classList.add('hidden');
  if (suitResolve) { suitResolve(suit); suitResolve = null; }
}

export function showRound(state, onNext) {
  const youWon = state.winner === 0;
  els.roundTitle.textContent = youWon ? 'You win the round!' : 'Opponent wins the round';
  els.roundText.textContent = youWon
    ? 'Opponent takes ' + state.scores[1] + ' penalty points.'
    : 'You take ' + state.scores[0] + ' penalty points.';
  els.roundScores.innerHTML =
    '<div class="' + (youWon ? 'win' : '') + '"><span>You</span><b>' + state.scores[0] + '</b></div>' +
    '<div class="' + (!youWon ? 'win' : '') + '"><span>Opponent</span><b>' + state.scores[1] + '</b></div>';
  const shareText = youWon
    ? 'I just won a round of Nigerian Whot on start.ng. Can you beat me?'
    : 'Nigerian Whot just beat me on start.ng. Can you do better?';
  const shareLink = /start\.ng$/.test(location.hostname) ? location.href : 'https://naija-whot.start.ng/';
  els.btnShare.onclick = function () {
    const url = 'https://x.com/intent/post?text=' + encodeURIComponent(shareText) +
      '&url=' + encodeURIComponent(shareLink);
    window.open(url, '_blank', 'noopener');
  };
  els.btnNext.onclick = function () {
    els.roundModal.classList.add('hidden');
    onNext();
  };
  els.roundModal.classList.remove('hidden');
}

export function hideModals() {
  els.roundModal.classList.add('hidden');
  els.suitModal.classList.add('hidden');
  els.rulesModal.classList.add('hidden');
  els.toast.classList.add('hidden');
}

/* ---------- online lobby ---------- */

export function showLobby(msg) {
  els.lobbyModal.classList.remove('hidden');
  els.lobbyChoice.classList.remove('hidden');
  els.waiting.classList.add('hidden');
  els.lobbyMsg.textContent = msg || '';
}

export function showWaiting(code) {
  els.lobbyModal.classList.remove('hidden');
  els.lobbyChoice.classList.add('hidden');
  els.waiting.classList.remove('hidden');
  els.waitCode.textContent = code;
  els.lobbyMsg.textContent = '';
}

export function hideLobby() {
  els.lobbyModal.classList.add('hidden');
}

export function lobbyError(msg) {
  els.lobbyMsg.textContent = msg;
}

export function lobbyCode() {
  return (els.joinCode.value || '').trim().toUpperCase();
}

export function lobbyName() {
  return (els.joinName.value || '').trim().slice(0, 16) || 'Player';
}

export function setRoomCode(code) {
  if (code) {
    els.roomPill.classList.remove('hidden');
    els.roomCodeTxt.textContent = code;
  } else {
    els.roomPill.classList.add('hidden');
  }
}

export function setOnline(on) {
  els.btnNew.textContent = on ? 'Leave room' : 'New game';
}

export function setRulesPill(rules) {
  const text = rulePillText(rules);
  if (!text) {
    els.rulePill.classList.add('hidden');
    return;
  }
  els.rulePill.textContent = text;
  els.rulePill.classList.remove('hidden');
}

/* ---------- setup panel ---------- */

function buildChips() {
  els.ruleChoices.innerHTML = '';
  RULE_CARDS.forEach(function (card) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.number = String(card.number);
    b.textContent = card.number + ' ' + card.name;
    b.addEventListener('click', function () {
      const exclude = settings.rules.exclude.slice();
      const at = exclude.indexOf(card.number);
      if (at === -1) exclude.push(card.number);
      else exclude.splice(at, 1);
      settings.rules = normaliseRules({ exclude: exclude });
      paintChips();
      saveSettings();
    });
    els.ruleChoices.appendChild(b);
  });
  paintChips();
}

function paintChips() {
  Array.prototype.forEach.call(els.ruleChoices.children, function (b) {
    const off = settings.rules.exclude.indexOf(Number(b.dataset.number)) !== -1;
    b.classList.toggle('off', off);
    b.setAttribute('aria-pressed', String(!off));
  });
}

function paintDifficulty() {
  Array.prototype.forEach.call(els.difficulty.children, function (b) {
    const on = (b.dataset.diff === 'strict') !== settings.hints;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  els.diffHint.textContent = settings.hints
    ? 'Guided glows the cards you can play.'
    : 'Strict leaves every card the same. You work out what is playable.';
}

export function setHints(on) {
  settings.hints = !!on;
  paintDifficulty();
  saveSettings();
}

/* ---------- defense on pick two and pick three ---------- */

function buildDefend() {
  els.defend.innerHTML = '';
  DEFENDABLE.forEach(function (d) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg';
    b.dataset.defend = String(d.number);
    b.textContent = d.name;
    b.addEventListener('click', function () {
      setDefend(settings.rules.defend.indexOf(d.number) === -1, d.number);
    });
    els.defend.appendChild(b);
  });
  paintDefend();
}

function paintDefend() {
  Array.prototype.forEach.call(els.defend.children, function (b) {
    const on = settings.rules.defend.indexOf(Number(b.dataset.defend)) !== -1;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  els.defendHint.textContent = settings.rules.defend.length === DEFENDABLE.length
    ? 'On lets the next player throw the same number back.'
    : 'Off: the next player pays instead of defending.';
}

export function setDefend(on, number) {
  const defend = settings.rules.defend.slice();
  const at = defend.indexOf(number);
  if (on) { if (at === -1) defend.push(number); }
  else if (at !== -1) defend.splice(at, 1);
  settings.rules = normaliseRules({ exclude: settings.rules.exclude, defend: defend });
  paintDefend();
  saveSettings();
}

export function init(cb) {
  ['scoreYou', 'scoreFoe', 'foeName', 'foeCount', 'foeHand', 'think', 'marketCount', 'market',
   'discard', 'callPill', 'turnPill', 'log', 'prompt', 'myHand', 'suitModal', 'suitChoices',
   'roundModal', 'roundTitle', 'roundText', 'roundScores', 'btnNext', 'btnShare', 'rulesModal', 'toast',
   'btnRules', 'btnRulesClose', 'btnNew', 'lobbyModal', 'lobbyChoice', 'waiting', 'waitCode',
   'btnCreate', 'btnJoin', 'btnLocal', 'btnCancelWait', 'joinCode', 'joinName', 'lobbyMsg',
   'roomPill', 'roomCodeTxt', 'rulePill', 'difficulty', 'diffHint', 'ruleChoices', 'defend', 'defendHint'].forEach(function (id) { els[id] = $(id); });

  els.market.addEventListener('click', function () { cb.onDraw(); });
  els.btnNew.addEventListener('click', function () { cb.onNew(); });
  els.btnRules.addEventListener('click', function () { els.rulesModal.classList.remove('hidden'); });
  els.btnRulesClose.addEventListener('click', function () { els.rulesModal.classList.add('hidden'); });

  els.btnCreate.addEventListener('click', function () { cb.onCreate(); });
  els.btnJoin.addEventListener('click', function () { cb.onJoin(); });
  els.joinCode.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') cb.onJoin();
  });
  els.btnLocal.addEventListener('click', function () { cb.onLocal(); });
  els.btnCancelWait.addEventListener('click', function () { cb.onCancelWait(); });

  Array.prototype.forEach.call(els.difficulty.children, function (b) {
    b.addEventListener('click', function () { setHints(b.dataset.diff === 'guided'); });
  });

  buildChips();
  paintDifficulty();
  buildDefend();

  els.myHand.addEventListener('click', function (e) {
    const btn = e.target.closest('button.card');
    if (!btn) return;
    cb.onPlay(btn.dataset.id, Number(btn.dataset.num));
  });

  // suit picker buttons
  els.suitChoices.innerHTML = '';
  SUITS.forEach(function (suit) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'suit-btn';
    b.innerHTML = GLYPHS[suit] + '<span>' + suit + '</span>';
    b.addEventListener('click', function () { closeSuit(suit); });
    els.suitChoices.appendChild(b);
  });

  onSuitPick = cb.onSuitPick;
}
