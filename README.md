# Whot

Play **Nigerian Whot** in the browser. The classic 54 card game with Hold on, Pick two, Suspension, General market and the wild Whot card.

**Live:** https://aphoe4x.github.io/whot/

## The rules

54 cards in five shapes: circles (12), triangles (12), crosses (9), squares (9), stars (7), plus five wild Whot cards numbered 20. No 6s, no 9s.

- Everyone is dealt **6 cards**, one card is flipped as the **call card** (always a plain number card, never a special).
- On your turn play a card matching the **shape** or the **number** of the call card, play a **Whot** on anything (and call the shape you want next), or **pick from the market** (ends your turn).

| Card | Effect |
| --- | --- |
| **1** Hold on | You play again |
| **2** Pick two | Next player picks 2, or defends with another 2. Each defended 2 grows the pick by 2 |
| **5** Pick three | Same with 5s, growing by 3 |
| **8** Suspension | Next player misses a turn. A **star 8** misses two players (3+ players) |
| **14** General market | Everyone else picks 1, then you play again |
| **20** Whot | Wild. Call the shape for the next player |

When the market runs out, everything under the call card is shuffled into a new market. First to empty their hand wins the round; everyone else scores their cards into the pot (stars count double, Whot counts 20).

## Phases

1. **Rules + board** (this): pure rules engine, playable table against a simple AI. `npm test`
2. **Multiplayer**: Node + Socket.IO realtime rooms with room codes and reconnect
3. **Ship**: single Docker container on Render, portfolio card

## Development

```bash
npm test        # engine test suite + fuzz games (no dependencies)
```

The engine (`js/engine.js`) is pure ESM with no DOM access, so the same rules run in the browser today and on the Node server in phase 2.

## License

MIT
