# 🦌 11th BSL Bend Open — Pronghorn Nicklaus

Live team scramble tracker for the 11th BSL Bend Open at Pronghorn Club (Nicklaus Course, Rust/Gold Combo tees · 6,292 yds · par 72 · M 69.7/137).

**Live app:** https://billyatminyawns.github.io/bsl-bend-open/

## Features
- Per-hole combo tee shown on the card (▲ Rust / ▼ Gold, from the scorecard arrows)
- Real-time team scoring (Firebase Realtime Database) — each team logs in with its own password and can only edit its own card
- Scramble requirement tracking per player: 2 drives (par 3s excluded), 2 second shots (par 3s count), 2 first putts (on the green)
- Live leaderboard with full hole-by-hole cards
- Birdie/eagle photo & video proof uploads (photos compressed client-side; videos up to 12 MB)
- Drinking-rules engine:
  - 🦅 Eagle → everyone shotguns / takes a shot (broadcast to all phones)
  - 🐦 Birdie → 3 of 4 players finish their drink + upload proof
  - 💀 Double bogey → send 3–4 drinks to a team of your choice (their phones get the alert)

## Local dev
```
python3 server.py   # http://localhost:8642
```
Without Firebase config the app runs in single-device demo mode.

## Firebase
Paste your Firebase web config into `firebase-config.js` (Realtime Database enabled). That's the whole backend.
