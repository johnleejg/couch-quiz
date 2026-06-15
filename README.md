# Couch Quiz

A local, couch-friendly multiplayer trivia game. One device hosts the game on a TV or laptop, and players answer from phones on the same Wi-Fi.

## Run it

```bash
npm install --cache .npm-cache
npm run dev
```

Open the printed `http://localhost:4173/host` address on the host device. The lobby QR code automatically uses the printed Wi-Fi IP address, so phones on the same network can connect directly.

## Game flow

1. Edit the included starter quiz or add quiz and true-or-false questions.
2. Open the lobby and let players scan the QR code.
3. Start the quiz when everyone appears on screen.
4. Players earn points for correct, fast answers and build streak bonuses.
5. Reveal answers, advance through the quiz, and finish on the podium.

Quiz questions support 2–6 text or image answers, single or multiple selection, 5-second to 4-minute timers, 0/1,000/2,000-point scoring, question images, and YouTube or Vimeo embeds. Time and points can also be applied to every question at once.

The game stores quiz drafts and reconnect keys in each browser. Uploaded images are kept in `uploads/`. Room state, timers, and scoring live only in the local Node server and reset when the server stops.

If the wrong network interface is selected, start the server with an explicit address:

```bash
PUBLIC_URL=http://192.168.1.25:4173 npm run dev
```
