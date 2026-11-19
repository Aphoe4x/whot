# Whot

Play **Nigerian Whot** in the browser. The classic 54 card game with Hold on, Pick two, Suspension, General market and the wild Whot card.

**Live:** https://aphoe4x.github.io/whot/ (single player + multiplayer via https://whot-okjn.onrender.com)

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

## House rules

Before a game starts, the setup panel lets you set the table. The choices
are remembered on the device, and the room creator sends them to everyone
in the room.

- **Difficulty**: Guided glows the cards you can play, Strict leaves
  every card the same. Strict works the same in a room as against the AI.
- **Cards in play**: turn a special card off, such as **5 Pick three** or
  **20 Whot**, to leave it out of the deck. Once off, the card is not in
  play for either player.
- **Defense**: turn Pick two or Pick three off and the next player must pay
  instead of being able to throw the same number back.

## Phases

1. **Rules + board**: pure rules engine, playable table against a simple AI. Shipped.
2. **Multiplayer**: Node + Socket.IO realtime rooms with room codes, per-seat hidden hands, reconnect and carried scores. Shipped.
3. **Ship** (this): single Docker container on Render, then a portfolio card. Docker image shipped and deployed.

## Development

```bash
npm install
npm test        # engine suite + room/live-server suite (no test framework)
npm start       # http://localhost:3000  (serves the game + realtime rooms)
```

Two ways to play:

- **`npm start`** gives the full thing: open the URL in two windows (or share it with a friend), create a room, send the 6 character code. The server validates every move with the same engine the browser uses, so rules can never drift between client and server. Hands are hidden per seat: each player only ever receives their own cards plus counts.
- **GitHub Pages** (`https://aphoe4x.github.io/whot/`) serves the game as static files: single player against the AI works with no server at all, and multiplayer works too because the client falls back to the deployed Render server below.

The engine (`js/engine.js`) is pure ESM with no DOM access, so the exact same rules run in the browser and on the server.

## Docker

The same game as one container, which is what Render runs in production:

```bash
docker build -t whot .
docker run -p 3000:3000 whot   # http://localhost:3000
```

The image ships only the game surface and the server: `index.html`, `style.css`, `js/`, `server/`. Tests, docs and dependencies for tests never leave your machine.

## License

MIT
