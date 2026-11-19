// Pure Nigerian Whot rules engine. No DOM, no dependencies.
// Works in the browser and in Node (ES modules) so Phase 2 can reuse it on the server.

export const SUITS = ['circles', 'triangles', 'crosses', 'squares', 'stars'];

export const SUIT_NUMBERS = {
  circles:   [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14],
  triangles: [1, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14],
  crosses:   [1, 2, 3, 5, 7, 10, 11, 13, 14],
  squares:   [1, 2, 3, 5, 7, 10, 11, 13, 14],
  stars:     [1, 2, 3, 4, 5, 7, 8],
};

export const SPECIAL_NAMES = {
  1: 'Hold on',
  2: 'Pick two',
  5: 'Pick three',
  8: 'Suspension',
  14: 'General market',
  20: 'Whot',
};

const EFFECT_NUMBERS = new Set([1, 2, 5, 8, 14, 20]);

// House rules: the special cards a table can leave out of the deck.
export const RULE_CARDS = [
  { number: 1, name: 'Hold on' },
  { number: 2, name: 'Pick two' },
  { number: 5, name: 'Pick three' },
  { number: 8, name: 'Suspension' },
  { number: 14, name: 'General market' },
  { number: 20, name: 'Whot' },
];

// Defense: the numbers that can push back on Pick two / Pick three.
export const DEFENDABLE = [
  { number: 2, name: 'Pick two' },
  { number: 5, name: 'Pick three' },
];

// House rules = { exclude: [5, 20], defend: [2, 5] }. Unknown numbers are
// dropped, so a client cannot ask for a card or a rule the engine doesn't know.
export function normaliseRules(rules) {
  const asked = (rules && rules.exclude) || [];
  const exclude = [];
  RULE_CARDS.forEach(function (r) {
    if (asked.indexOf(r.number) !== -1 && exclude.indexOf(r.number) === -1) exclude.push(r.number);
  });
  const defendAsked = (rules && rules.defend) || null;
  const defend = DEFENDABLE.filter(function (d) {
    return defendAsked ? defendAsked.indexOf(d.number) !== -1 : true;
  }).map(function (d) { return d.number; });
  return { exclude: exclude, defend: defend };
}

// Plain English for the log.
export function ruleText(rules) {
  const parts = [];
  const names = leftOut(rules);
  if (names.length) parts.push('Left out of the game: ' + names.join(', ') + '.');
  const noDefend = leftOutDefend(rules);
  if (noDefend.length) parts.push('Defense is off on ' + noDefend.join(', ') + '.');
  return parts.join(' ');
}

// Short form for the pill in the top bar: "No 5 or 20".
export function rulePillText(rules) {
  const nums = leftOut(rules).map(function (n) { return n.split(' ')[0]; });
  if (!nums.length) return '';
  return 'No ' + nums.join(' or ');
}

function leftOut(rules) {
  const exclude = (rules && rules.exclude) || [];
  return RULE_CARDS.filter(function (r) { return exclude.indexOf(r.number) !== -1; })
    .map(function (r) { return r.number + ' ' + r.name; });
}

function leftOutDefend(rules) {
  if (!rules || rules.defend == null) return [];
  return DEFENDABLE.filter(function (d) { return rules.defend.indexOf(d.number) === -1; })
    .map(function (d) { return d.name; });
}

export function shuffle(arr, rng) {
  rng = rng || Math.random;
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

// 54 cards: circles 12, triangles 12, crosses 9, squares 9, stars 7, Whot 5. No 6s or 9s.
// House rules drop whole numbers out of the deck before the shuffle.
export function buildDeck(rng, rules) {
  const exclude = new Set(normaliseRules(rules).exclude);
  const deck = [];
  for (const suit of SUITS) {
    for (const n of SUIT_NUMBERS[suit]) {
      if (exclude.has(n)) continue;
      deck.push({ id: suit + '-' + n, suit: suit, number: n });
    }
  }
  for (let i = 1; i <= 5; i++) {
    if (exclude.has(20)) continue;
    deck.push({ id: 'whot-' + i, suit: 'whot', number: 20 });
  }
  return shuffle(deck, rng);
}

export function topOf(state) {
  return state.pile[state.pile.length - 1];
}

export function label(card) {
  if (card.number === 20) return 'Whot';
  return card.suit + ' ' + card.number;
}

export function handValue(hand) {
  let total = 0;
  for (const c of hand) {
    if (c.number === 20) total += 20;
    else if (c.suit === 'stars') total += c.number * 2;
    else total += c.number;
  }
  return total;
}

// Cards a player is allowed to play right now.
export function legalCards(state, idx) {
  const hand = state.players[idx].hand;
  if (state.pending && state.pending.player === idx) {
    // Facing a pick two / pick three: only same-number defense cards are
    // allowed, and only when the table allows defending at all.
    const defendOn = !state.rules || state.rules.defend.indexOf(state.pending.number) !== -1;
    if (!defendOn) return [];
    return hand.filter(function (c) { return c.number === state.pending.number; });
  }
  const top = topOf(state);
  if (!top) return hand.slice();
  return hand.filter(function (c) {
    if (c.number === 20) return true;              // Whot plays on anything
    if (top.number === 20) return c.suit === state.callSuit; // must follow the call
    return c.suit === top.suit || c.number === top.number;
  });
}

function drawCards(state, player, n, ev) {
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (!state.market.length && state.pile.length > 1) {
      // Market empty: shuffle everything under the call card into a new market.
      const keep = state.pile.pop();
      state.market = state.pile;
      state.pile = [keep];
      shuffle(state.market, state.rng);
      ev.push('Market reshuffled');
    }
    if (!state.market.length) break;
    player.hand.push(state.market.pop());
    count++;
  }
  return count;
}

function announce(state, player, ev) {
  if (player.hand.length === 1) ev.push(player.name + ': Last card!');
}

function endRound(state, winnerIdx, ev) {
  state.phase = 'ended';
  state.winner = winnerIdx;
  let penalty = 0;
  state.players.forEach(function (pl, i) {
    if (i !== winnerIdx) {
      const v = handValue(pl.hand);
      state.scores[i] += v;
      penalty += v;
    }
  });
  const w = state.players[winnerIdx];
  ev.push(w.name + ' wins the round!' + (penalty ? ' +' + penalty + ' penalty points' : ''));
}

export function createGame(opts) {
  opts = opts || {};
  const rng = opts.rng || Math.random;
  const players = opts.players || [
    { id: 'you', name: 'You', isAI: false },
    { id: 'ai', name: 'Opponent', isAI: true },
  ];
  const handSize = opts.handSize == null ? 6 : opts.handSize;
  const rules = normaliseRules(opts.rules);
  const state = {
    players: players.map(function (p) { return { id: p.id, name: p.name, isAI: !!p.isAI, hand: [] }; }),
    rules: rules,
    market: [],
    pile: [],
    callSuit: null,
    turn: 0,
    phase: 'playing',
    pending: null,
    winner: null,
    scores: opts.carryScores ? opts.carryScores.slice() : players.map(function () { return 0; }),
    log: [],
    rng: rng,
  };

  const deck = buildDeck(rng, rules);
  for (let r = 0; r < handSize; r++) {
    for (const p of state.players) p.hand.push(deck.pop());
  }
  // Call card must be a plain number card (no special effects on the first flip).
  for (let i = deck.length - 1; i >= 0; i--) {
    if (!EFFECT_NUMBERS.has(deck[i].number)) {
      const last = deck.length - 1;
      const tmp = deck[i];
      deck[i] = deck[last];
      deck[last] = tmp;
      break;
    }
  }
  const call = deck.pop();
  state.pile.push(call);
  state.market = deck;
  state.log.push('Dealt ' + handSize + ' cards each. Call card: ' + label(call) + '.');
  return state;
}

function fail(reason, ev) {
  return { ok: false, reason: reason, events: ev };
}

// Apply a player action: {type:'play', cardId, callSuit?} | {type:'draw'} | {type:'pay'}
export function applyAction(state, action) {
  const ev = [];
  if (state.phase !== 'playing') return fail('Game is over', ev);
  const idx = state.turn;
  const p = state.players[idx];
  const n = state.players.length;
  const adv = function (k) { return (idx + k) % n; };

  if (action.type === 'play') {
    const card = p.hand.find(function (c) { return c.id === action.cardId; });
    if (!card) return fail('That card is not in your hand', ev);
    if (!legalCards(state, idx).some(function (c) { return c.id === card.id; })) {
      return fail('Card does not match the call card', ev);
    }
    if (card.number === 20 && SUITS.indexOf(action.callSuit) === -1) {
      return fail('Call a suit for your Whot card', ev);
    }

    p.hand.splice(p.hand.indexOf(card), 1);
    state.pile.push(card);
    ev.push(p.name + ' played ' + label(card));

    if (card.number === 20) {
      state.callSuit = action.callSuit;
      ev.push(p.name + ' calls ' + action.callSuit);
    } else {
      state.callSuit = null;
    }

    if (p.hand.length === 0) {
      endRound(state, idx, ev);
      return { ok: true, events: ev };
    }

    // Defending a pick two / pick three chain.
    if (state.pending && card.number === state.pending.number) {
      state.pending.chain += 1;
      state.pending.amount = state.pending.number === 2 ? state.pending.chain * 2 : state.pending.chain * 3;
      state.pending.player = adv(1);
      state.turn = state.pending.player;
      ev.push('Chain! Now pick ' + state.pending.amount + ', ' + state.players[state.pending.player].name);
      announce(state, p, ev);
      return { ok: true, events: ev };
    }

    state.pending = null;
    let next;

    if (card.number === 1) {
      ev.push(p.name + ': Hold on!');
      next = adv(0); // same player plays again
    } else if (card.number === 8) {
      const skips = card.suit === 'stars' && n > 2 ? 2 : 1;
      ev.push(p.name + ': Suspension!');
      next = adv(1 + skips);
    } else if (card.number === 14) {
      ev.push(p.name + ': General market!');
      for (let k = 1; k < n; k++) {
        drawCards(state, state.players[adv(k)], 1, ev);
      }
      next = adv(0); // general market player plays again
    } else if (card.number === 2 || card.number === 5) {
      const nextIdx = adv(1);
      state.pending = {
        number: card.number,
        amount: card.number === 2 ? 2 : 3,
        chain: 1,
        player: nextIdx,
      };
      ev.push(card.number === 2
        ? 'Pick two! ' + state.players[nextIdx].name + ' defends with a 2 or picks 2'
        : 'Pick three! ' + state.players[nextIdx].name + ' defends with a 5 or picks 3');
      next = nextIdx;
    } else {
      next = adv(1);
    }

    announce(state, p, ev);
    state.turn = next;
    return { ok: true, events: ev };
  }

  if (action.type === 'draw') {
    if (state.pending) return fail('Pay the penalty or defend with the matching card', ev);
    const count = drawCards(state, p, 1, ev);
    ev.push(count ? p.name + ' went to market' : p.name + ': market empty, pass');
    state.turn = adv(1);
    return { ok: true, events: ev };
  }

  if (action.type === 'pay') {
    if (!state.pending || state.pending.player !== idx) return fail('Nothing to pay', ev);
    const amount = state.pending.amount;
    const count = drawCards(state, p, amount, ev);
    ev.push(p.name + ' picked ' + count + (count < amount ? ' (market ran out)' : ''));
    state.pending = null;
    state.turn = adv(1);
    return { ok: true, events: ev };
  }

  return fail('Unknown action', ev);
}
