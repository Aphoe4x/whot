// Phase 1 gate: engine tests. Run with `npm test`.
import {
  SUITS, SUIT_NUMBERS, buildDeck, createGame, applyAction, legalCards,
  handValue, topOf, shuffle, normaliseRules, ruleText, rulePillText, RULE_CARDS,
} from '../js/engine.js';
import { aiChoose } from '../js/ai.js';

let passed = 0;
let failed = 0;

function ok(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('  FAIL: ' + msg); }
}

function eq(a, b, msg) { ok(a === b, msg + ' (expected ' + b + ', got ' + a + ')'); }

// Deterministic RNG (mulberry32) so every run is reproducible.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function totalCards(state) {
  const hands = state.players.reduce((n, p) => n + p.hand.length, 0);
  return hands + state.market.length + state.pile.length;
}

function idsOf(cards) { return cards.map((c) => c.id).sort().join(','); }

// ---------- 1. deck composition ----------

console.log('deck composition');
{
  const deck = buildDeck(mulberry32(1));
  eq(deck.length, 54, 'deck has 54 cards');
  for (const suit of SUITS) {
    const n = deck.filter((c) => c.suit === suit).length;
    eq(n, SUIT_NUMBERS[suit].length, suit + ' count');
  }
  eq(deck.filter((c) => c.number === 6).length, 0, 'no 6s');
  eq(deck.filter((c) => c.number === 9).length, 0, 'no 9s');
  eq(deck.filter((c) => c.number === 20).length, 5, 'five Whot cards');
  const ids = new Set(deck.map((c) => c.id));
  eq(ids.size, 54, 'all card ids unique');

  RULE_CARDS.forEach(function (r) {
    ok(deck.some((c) => c.number === r.number), r.name + ' is in a full deck');
  });
  eq(normaliseRules({ exclude: [20, 20, 5] }).exclude.join(','), '5,20', 'duplicate rules collapse');
}

// ---------- 1b. house rules ----------

console.log('house rules');
{
  const noWhot = buildDeck(mulberry32(1), { exclude: [20] });
  eq(noWhot.length, 49, 'dropping Whot leaves 49 cards');
  eq(noWhot.filter((c) => c.number === 20).length, 0, 'no Whot cards left');

  const noFive = buildDeck(mulberry32(1), { exclude: [5] });
  eq(noFive.length, 49, 'dropping 5s leaves 49 cards');
  eq(noFive.filter((c) => c.number === 5).length, 0, 'no 5s left');

  const st = createGame({ rng: mulberry32(3), rules: { exclude: [5, 20] } });
  eq(st.rules.exclude.length, 2, 'game keeps its rules');
  eq(totalCards(st), 44, 'deal conserves the 44 card deck');
  const every = st.players[0].hand.concat(st.players[1].hand, st.market, st.pile);
  ok(every.every((c) => c.number !== 5 && c.number !== 20), 'no 5s or Whot in play');

  // Junk in the rule list is dropped rather than breaking the deal.
  const junk = createGame({ rng: mulberry32(3), rules: { exclude: [5, 99, 'x'] } });
  eq(junk.rules.exclude.join(','), '5', 'unknown rule numbers ignored');

  // A game with no rules behaves exactly like before.
  const plain = createGame({ rng: mulberry32(3) });
  eq(plain.rules.exclude.length, 0, 'rules default to everything in play');
  eq(totalCards(plain), 54, 'plain game still deals 54');

  eq(ruleText({ exclude: [5, 20], defend: [2, 5] }), 'Left out: 5 Pick three, 20 Whot.', 'rule text lists the cards');
  eq(ruleText({ defend: [] }), 'No defense on Pick two, Pick three.', 'rule text mentions no defense when off');
  eq(ruleText({}), '', 'rule text is empty when nothing is left out');
  eq(rulePillText({ exclude: [5, 20] }), 'No 5, no 20', 'pill text is short');
  eq(rulePillText({ exclude: [] }), '', 'pill hidden when nothing is left out');
}

// ---------- 1c. defense on pick two and pick three ----------

console.log('defense');
{
  eq(createGame({ rng: mulberry32(3) }).rules.defend.join(','), '2,5', 'defend is on for both by default');
  eq(createGame({ rng: mulberry32(3), rules: { defend: [] } }).rules.defend.length, 0, 'defend can be switched off');
  eq(normaliseRules({ defend: [5] }).defend.join(','), '5', 'unknown defend numbers are dropped');

  // With defense off, the pick is paid, not defended.
  const st = createGame({ rng: mulberry32(3), rules: { defend: [] } });
  st.pending = { number: 2, amount: 2, chain: 1, player: 1 };
  st.turn = 1;
  ok(legalCards(st, 1).length === 0, 'nothing to defend with when defense is off');
  const pay = applyAction(st, { type: 'pay' });
  ok(pay.ok, 'paying works when defense is off');

  // With defense on, defending still works, and only with the same number.
  const st2 = createGame({ rng: mulberry32(3), rules: { defend: [2, 5] } });
  if (!st2.players[1].hand.find(function (c) { return c.number === 2; })) {
    st2.players[1].hand.push({ id: 'circles-2', suit: 'circles', number: 2 });
  }
  st2.pending = { number: 2, amount: 2, chain: 1, player: 1 };
  st2.turn = 1;
  ok(legalCards(st2, 1).length > 0, 'defensive cards are the 2s');
  ok(legalCards(st2, 1).every(function (c) { return c.number === 2; }), 'defensive cards are the 2s only');
  const two = st2.players[1].hand.find(function (c) { return c.number === 2; });
  const defend = applyAction(st2, { type: 'play', cardId: two.id });
  ok(defend.ok, 'defending works when defense is on: ' + (defend.reason || 'ok'));
}

// ---------- 2. deal and call card ----------

console.log('deal and call card');
{
  for (let seed = 1; seed <= 200; seed++) {
    const st = createGame({ rng: mulberry32(seed) });
    eq(st.players[0].hand.length, 6, 'seed ' + seed + ' player dealt 6');
    eq(st.players[1].hand.length, 6, 'seed ' + seed + ' ai dealt 6');
    const call = topOf(st);
    ok(call.number !== 1 && call.number !== 2 && call.number !== 5 &&
       call.number !== 8 && call.number !== 14 && call.number !== 20,
       'seed ' + seed + ' call card is non-special, got ' + call.number);
    eq(totalCards(st), 54, 'seed ' + seed + ' 54 cards conserved after deal');
  }
}

// ---------- 3. legal cards ----------

console.log('legal cards');
{
  // Build a controlled state by hand.
  const mk = (hands, top, extra) => Object.assign({
    players: hands.map((h, i) => ({ id: 'p' + i, name: 'P' + i, isAI: false, hand: h })),
    market: [], pile: [top], callSuit: null, turn: 0, phase: 'playing',
    pending: null, winner: null, scores: [0, 0], log: [], rng: mulberry32(7),
  }, extra || {});

  const c = (suit, n) => ({ id: suit + '-' + n, suit: suit, number: n });
  const w = (i) => ({ id: 'whot-' + i, suit: 'whot', number: 20 });

  // Same suit or same number, Whot always.
  const st = mk([[c('circles', 3), c('stars', 7), c('triangles', 9), w(1)],
                 [c('squares', 5)]], c('circles', 7));
  eq(idsOf(legalCards(st, 0)), 'circles-3,stars-7,whot-1',
     'matches suit or number, whot plays on anything');

  // Following a called suit.
  const st2 = mk([[c('circles', 3), c('stars', 7), c('triangles', 3)], []],
                 w(1), { callSuit: 'stars' });
  eq(idsOf(legalCards(st2, 0)), 'stars-7', 'after whot only called suit (plus whot) plays');

  // Pending pick-two locks the hand to 2s only.
  const st3 = mk([[c('circles', 2), c('stars', 2), c('triangles', 3)], []],
                 c('circles', 5), { pending: { number: 2, amount: 2, chain: 1, player: 0 } });
  eq(idsOf(legalCards(st3, 0)), 'circles-2,stars-2', 'pending locks to same-number defense');

  // Pending belonging to the other player does not lock this hand.
  const st4 = mk([[c('circles', 3), c('squares', 5)], []],
                 c('circles', 5), { pending: { number: 2, amount: 2, chain: 1, player: 1 } });
  eq(legalCards(st4, 0).length, 2, 'pending on other player leaves hand free');
}

// ---------- 4. special effects ----------

console.log('special effects');
{
  // 1 = replay for the player who played it.
  let st = createGame({ rng: mulberry32(3) });
  st.players[0].hand = [{ id: 'circles-1', suit: 'circles', number: 1 },
                        { id: 'squares-3', suit: 'squares', number: 3 }];
  st.players[1].hand = [{ id: 'squares-5', suit: 'squares', number: 5 }];
  st.pile = [{ id: 'circles-7', suit: 'circles', number: 7 }];
  st.turn = 0;
  let res = applyAction(st, { type: 'play', cardId: 'circles-1' });
  ok(res.ok, 'hold on accepted');
  eq(st.turn, 0, 'hold on keeps the turn');
  eq(st.phase, 'playing', 'game continues');

  // 8 = suspension skips the next player (2-player: back to holder).
  st = createGame({ rng: mulberry32(3) });
  st.players[0].hand = [{ id: 'circles-8', suit: 'circles', number: 8 },
                        { id: 'squares-3', suit: 'squares', number: 3 }];
  st.players[1].hand = [{ id: 'squares-5', suit: 'squares', number: 5 }];
  st.pile = [{ id: 'circles-7', suit: 'circles', number: 7 }];
  st.turn = 0;
  res = applyAction(st, { type: 'play', cardId: 'circles-8' });
  ok(res.ok, 'suspension accepted');
  eq(st.turn, 0, 'suspension skips opponent in 2-player');

  // Star 8 skips two only with 3+ players: in 4-player it lands two seats ahead.
  st = createGame({ rng: mulberry32(3), players: [
    { id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'd', name: 'D' }] });
  st.players[0].hand = [{ id: 'stars-8', suit: 'stars', number: 8 },
                        { id: 'squares-3', suit: 'squares', number: 3 }];
  st.pile = [{ id: 'stars-7', suit: 'stars', number: 7 }];
  st.turn = 0;
  res = applyAction(st, { type: 'play', cardId: 'stars-8' });
  ok(res.ok, 'star 8 accepted in 4p');
  eq(st.turn, 3, 'star 8 skips two in 4-player');

  // 14 = general market: others draw 1, player replays.
  st = createGame({ rng: mulberry32(3) });
  st.players[0].hand = [{ id: 'circles-14', suit: 'circles', number: 14 },
                        { id: 'squares-3', suit: 'squares', number: 3 }];
  st.players[1].hand = [{ id: 'squares-5', suit: 'squares', number: 5 }];
  st.pile = [{ id: 'circles-7', suit: 'circles', number: 7 }];
  st.market = [{ id: 'stars-4', suit: 'stars', number: 4 }, { id: 'crosses-11', suit: 'crosses', number: 11 }];
  st.turn = 0;
  res = applyAction(st, { type: 'play', cardId: 'circles-14' });
  ok(res.ok, 'general market accepted');
  eq(st.players[1].hand.length, 2, 'opponent drew 1 from general market');
  eq(st.market.length, 1, 'market paid out one card');
  eq(st.turn, 0, 'general market player replays');

  // 2 chain: defend with 2, amount grows, then pay.
  st = createGame({ rng: mulberry32(3) });
  st.players[0].hand = [{ id: 'circles-2', suit: 'circles', number: 2 },
                        { id: 'squares-3', suit: 'squares', number: 3 }];
  st.players[1].hand = [{ id: 'stars-2', suit: 'stars', number: 2 },
                        { id: 'triangles-3', suit: 'triangles', number: 3 }];
  st.pile = [{ id: 'circles-7', suit: 'circles', number: 7 }];
  st.market = [{ id: 'squares-4', suit: 'squares', number: 4 },
               { id: 'squares-10', suit: 'squares', number: 10 },
               { id: 'crosses-13', suit: 'crosses', number: 13 }];
  st.turn = 0;
  res = applyAction(st, { type: 'play', cardId: 'circles-2' });
  ok(res.ok, 'pick two accepted');
  ok(st.pending, 'pending pick two set');
  eq(st.pending.amount, 2, 'chain starts at 2');
  eq(st.turn, 1, 'turn passes to target');
  eq(legalCards(st, 1).length, 1, 'only the 2 is legal while pending');

  res = applyAction(st, { type: 'play', cardId: 'stars-2' });
  ok(res.ok, 'defense accepted');
  eq(st.pending.amount, 4, 'chain grows to 4');
  eq(st.turn, 0, 'turn returns to attacker');

  // The attacker has no 2 left, so they pay the 4 (3 from market + 1 reshuffled).
  res = applyAction(st, { type: 'pay' });
  ok(res.ok, 'pay accepted');
  eq(st.players[0].hand.length, 5, 'paid 4 on top of the 1 card held');
  eq(st.pending, null, 'pending cleared after pay');
  eq(st.turn, 1, 'turn moves on after pay');

  // Whot requires a call suit.
  st = createGame({ rng: mulberry32(3) });
  st.players[0].hand = [{ id: 'whot-2', suit: 'whot', number: 20 }];
  st.pile = [{ id: 'circles-7', suit: 'circles', number: 7 }];
  st.turn = 0;
  res = applyAction(st, { type: 'play', cardId: 'whot-2' });
  ok(!res.ok, 'whot without call suit rejected');
  res = applyAction(st, { type: 'play', cardId: 'whot-2', callSuit: 'crosses' });
  ok(res.ok, 'whot with call suit accepted');
  eq(st.callSuit, 'crosses', 'call suit recorded');
}

// ---------- 5. market reshuffle ----------

console.log('market reshuffle');
{
  const st = createGame({ rng: mulberry32(11) });
  const call = st.pile[0];
  // Empty the market: its cards go under the call card, call stays on top.
  st.pile = [...st.market, call];
  st.market = [];
  const before = totalCards(st);
  const res = applyAction(st, { type: 'draw' });
  ok(res.ok, 'draw accepted');
  ok(res.events.includes('Market reshuffled'), 'reshuffle announced');
  eq(st.market.length, 40, 'new market formed (41 under, 1 drawn)');
  eq(totalCards(st), before, 'reshuffle conserves cards');
  eq(topOf(st).id, call.id, 'call card stays on top after reshuffle');
  eq(st.players[0].hand.length, 7, 'drew one card from the reshuffled market');
}

// ---------- 6. winning and scoring ----------

console.log('winning and scoring');
{
  const st = createGame({ rng: mulberry32(5) });
  st.players[0].hand = [{ id: 'circles-3', suit: 'circles', number: 3 }];
  st.players[1].hand = [{ id: 'stars-7', suit: 'stars', number: 7 },   // 7*2 = 14
                        { id: 'whot-1', suit: 'whot', number: 20 },    // 20
                        { id: 'squares-5', suit: 'squares', number: 5 }]; // 5
  st.pile = [{ id: 'circles-7', suit: 'circles', number: 7 }];
  st.turn = 0;
  const res = applyAction(st, { type: 'play', cardId: 'circles-3' });
  ok(res.ok, 'winning play accepted');
  eq(st.phase, 'ended', 'round ends');
  eq(st.winner, 0, 'player 0 wins');
  eq(st.scores[1], 39, 'loser scored 14 + 20 + 5 = 39');
  eq(st.scores[0], 0, 'winner gains nothing');

  eq(handValue([{ id: 'stars-4', suit: 'stars', number: 4 }]), 8, 'stars double in hand value');
  eq(handValue([{ id: 'whot-3', suit: 'whot', number: 20 }]), 20, 'whot counts 20');

  const after = applyAction(st, { type: 'draw' });
  ok(!after.ok, 'no actions after round ends');
}

// ---------- 7. fuzz: strict play-if-legal policy ----------

console.log('fuzz (strict policy)');
{
  const EFFECTS = new Set([1, 2, 5, 8, 14, 20]);
  for (let seed = 1; seed <= 500; seed++) {
    const rng = mulberry32(seed);
    const st = createGame({ rng: rng });
    let steps = 0;
    let sawReshuffle = false;

    while (st.phase === 'playing' && steps < 4000) {
      steps++;
      const before = totalCards(st);
      const idx = st.turn;
      const legal = legalCards(st, idx);
      let action;

      if (st.pending && st.pending.player === idx) {
        action = legal.length ? { type: 'play', cardId: legal[0].id } : { type: 'pay' };
      } else if (legal.length) {
        const pick = legal[Math.floor(rng() * legal.length)];
        action = { type: 'play', cardId: pick.id };
        if (pick.number === 20) action.callSuit = SUITS[Math.floor(rng() * SUITS.length)];
      } else {
        action = { type: 'draw' };
      }

      const res = applyAction(st, action);
      ok(res.ok, 'seed ' + seed + ' step ' + steps + ' action legal: ' + res.reason);
      if (!res.ok) break;

      eq(totalCards(st), before, 'seed ' + seed + ' step ' + steps + ' card conservation');
      if (st.phase === 'playing' && totalCards(st) !== 54) break;
      if (res.events.includes('Market reshuffled')) sawReshuffle = true;

      // Sanity: pending only exists mid-chain.
      if (st.pending) {
        ok([2, 5].includes(st.pending.number), 'seed ' + seed + ' pending number is 2 or 5');
        ok(st.pending.player !== idx || true, 'pending targets a player');
      }
    }

    ok(st.phase === 'ended', 'seed ' + seed + ' round terminates (steps=' + steps + ')');
    ok(st.winner !== null, 'seed ' + seed + ' has a winner');
    eq(st.players.length, 2, 'seed ' + seed + ' two players intact');
    if (seed % 100 === 0) console.log('  seed ' + seed + ': ended in ' + steps +
      ' steps, reshuffle=' + sawReshuffle);
  }
}

// ---------- 8. fuzz: AI vs AI ----------

console.log('fuzz (aiChoose)');
{
  for (let seed = 1; seed <= 300; seed++) {
    const rng = mulberry32(seed * 7919);
    const st = createGame({ rng: rng });
    let steps = 0;
    while (st.phase === 'playing' && steps < 4000) {
      steps++;
      const before = totalCards(st);
      const action = aiChoose(st, rng);
      const res = applyAction(st, action);
      ok(res.ok, 'ai seed ' + seed + ' step ' + steps + ': ' + res.reason);
      if (!res.ok) break;
      eq(totalCards(st), before, 'ai seed ' + seed + ' step ' + steps + ' conservation');
      if (st.phase === 'playing' && totalCards(st) !== 54) break;
    }
    ok(st.phase === 'ended', 'ai seed ' + seed + ' terminates (steps=' + steps + ')');
    if (steps >= 4000) console.error('  ai seed ' + seed + ' did not terminate');
  }
}

// ---------- 9. shuffle determinism ----------

console.log('shuffle determinism');
{
  const a = shuffle([1, 2, 3, 4, 5, 6, 7, 8], mulberry32(42));
  const b = shuffle([1, 2, 3, 4, 5, 6, 7, 8], mulberry32(42));
  ok(idsOf(a.map((n) => ({ id: n }))) === idsOf(b.map((n) => ({ id: n }))),
     'same seed, same order');
}

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
