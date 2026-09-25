# 🦌 11th BSL Bend Open — Pronghorn Nicklaus

Live team scramble tracker for the 11th BSL Bend Open at Pronghorn Club (Nicklaus Course, Rust/Gold Combo tees · 6,292 yds · par 72 · M 69.7/137).

**Live app:** https://billyatminyawns.github.io/bsl-bend-open/

## Features
- Per-hole combo tee shown on the card (▲ Rust / ▼ Gold, from the scorecard arrows)
- Real-time team scoring (Firebase Realtime Database) — each team logs in with its own password and can only edit its own card
- Scramble requirement tracking per player: 2 drives + 2 second shots (a par-3 tee shot counts as either one, team's choice), 2 first putts (on the green)
- Live leaderboard with full hole-by-hole cards
- Birdie/eagle photo & video proof uploads (photos compressed client-side; videos up to 50 MB (chunked into the DB))
- Drinking-rules engine:
  - 🦅 Eagle → everyone shotguns / takes a shot (broadcast to all phones)
  - 🐦 Birdie → 3 of 4 players finish their drink + upload proof
  - 💀 Double bogey → send 3–4 drinks to a team of your choice (their phones get the alert)
- 📈 **Market tab** — zero-sum side-bet pools (play money, no house):
  - Every player gets 🪙10 Bend Bucks for four pools: **18-hole winner**, **Long drive** and **Closest to the pin** (all 16 players eligible), and **Eagle watch** (yes/no)
  - Pari-mutuel: each pool's pot is split among whoever backed the winner, pro rata to stakes — every Bend Buck won is one someone else lost
  - Odds = each pick's share of the pot and move with every bet; bets are final
  - 18-hole winner and Eagle watch close at the turn; contests close when the first group reaches the hole (Team Billy can change contest holes in the app)
  - Groups record their best long drive / closest shot after the hole; pools settle automatically (ties split the pot; no winning bets → refunds)
  - Bets run as Firebase transactions, so simultaneous bets can't overspend a wallet

## Local dev
```
python3 server.py   # http://localhost:8642
```
Without Firebase config the app runs in single-device demo mode.

Add `?sandbox=<name>` to the URL (e.g. `…/bsl-bend-open/?sandbox=practice`) to use an isolated practice copy of the database — scores and bets there never touch the real event.

## Firebase
Paste your Firebase web config into `firebase-config.js` (Realtime Database enabled). That's the whole backend.
