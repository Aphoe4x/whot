// Simple but sensible Whot opponent. Pure: reads game state, returns an action.
import { legalCards, SUITS } from './engine.js';

function countSuit(hand, suit) {
  return hand.filter(function (c) { return c.suit === suit; }).length;
}

function countNumber(hand, number) {
  return hand.filter(function (c) { return c.number === number; }).length;
}

// Best suit to call when playing a Whot card: the suit we hold most.
function callSuitChoice(hand) {
  let best = SUITS[0];
  let bestCount = -1;
  for (const s of SUITS) {
    const c = countSuit(hand, s);
    if (c > bestCount) { bestCount = c; best = s; }
  }
  if (bestCount <= 0) return SUITS[Math.floor(Math.random() * SUITS.length)];
  return best;
}

export function aiChoose(state, rng) {
  rng = rng || Math.random;
  const idx = state.turn;
  const me = state.players[idx];
  const n = state.players.length;
  const foe = state.players[(idx + 1) % n];

  // Facing a pick two / pick three chain.
  if (state.pending && state.pending.player === idx) {
    const defenses = me.hand.filter(function (c) { return c.number === state.pending.number; });
    if (defenses.length) {
      // Defending is always free, so always defend. Play the cheapest one.
      let pick = defenses[0];
      for (const c of defenses) if (c.number < pick.number) pick = c;
      return { type: 'play', cardId: pick.id };
    }
    return { type: 'pay' };
  }

  const legal = legalCards(state, idx);
  if (!legal.length) return { type: 'draw' };

  const foeLow = foe.hand.length <= 2;
  let best = null;
  let bestScore = -Infinity;

  for (const c of legal) {
    let s = rng() * 10;

    if (c.number === 20) {
      s += legal.length > 1 ? -60 : 0;
      s += me.hand.length === 1 ? 10000 : 0;
    } else {
      s += countSuit(me.hand, c.suit) * 6;
      s += countNumber(me.hand, c.number) * 4;
      if (c.number === 2 || c.number === 5) s += foeLow ? 160 : -30;
      if (c.number === 1 || c.number === 8) s += foeLow ? 140 : -10;
      if (c.number === 14) s += foeLow ? 120 : -40;
      if (c.number >= 10) s += 8;
    }

    const after = me.hand.length - 1;
    if (after === 0) s += 10000;
    else if (after === 1) s += 90;

    if (s > bestScore) { bestScore = s; best = c; }
  }

  if (!best) return { type: 'draw' };
  const action = { type: 'play', cardId: best.id };
  if (best.number === 20) action.callSuit = callSuitChoice(me.hand);
  return action;
}
