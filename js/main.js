// Wires the engine, the AI and the table together.
import { createGame, applyAction } from './engine.js';
import { aiChoose } from './ai.js';
import * as ui from './ui.js';

let state = null;
let busy = false;

function renderAll() {
  const aiTurn = state.phase === 'playing' && state.players[state.turn].isAI;
  ui.render(state, { aiTurn: aiTurn, busy: busy, onPay: onPay });
}

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

function onPlay(cardId, number) {
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

function onDraw() { humanAct({ type: 'draw' }); }
function onPay() { humanAct({ type: 'pay' }); }

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

ui.init({
  onPlay: onPlay,
  onDraw: onDraw,
  onPay: onPay,
  onNew: newGame,
});

newGame();
