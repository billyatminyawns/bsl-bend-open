// ── 11th BSL Bend Open · Pronghorn Nicklaus · Rust/Gold Combo ──
// Course data transcribed from the official Pronghorn Club scorecard (02/23).
// Combo tee per hole comes from the ▲/▼ markers between the RUST and GOLD rows:
// ▲ = play Rust, ▼ = play Gold. Totals cross-checked against the printed 6292.

const COURSE = {
  name: "Pronghorn Club · Nicklaus Course",
  tees: "Rust/Gold Combo",
  rating: "M: 69.7/137 · L: 76.0/148",
  totalYards: 6292,
  totalPar: 72,
  holes: [
    // hole, yards (combo), tee played, par, hcp (men's)
    { h: 1,  yds: 355, tee: "R", par: 4, hcp: 17 },
    { h: 2,  yds: 524, tee: "R", par: 5, hcp: 7  },
    { h: 3,  yds: 203, tee: "R", par: 3, hcp: 11 },
    { h: 4,  yds: 300, tee: "R", par: 4, hcp: 15 },
    { h: 5,  yds: 383, tee: "G", par: 4, hcp: 9  },
    { h: 6,  yds: 369, tee: "G", par: 4, hcp: 3  },
    { h: 7,  yds: 137, tee: "R", par: 3, hcp: 13 },
    { h: 8,  yds: 589, tee: "R", par: 5, hcp: 1  },
    { h: 9,  yds: 380, tee: "G", par: 4, hcp: 5  },
    { h: 10, yds: 328, tee: "G", par: 4, hcp: 4  },
    { h: 11, yds: 380, tee: "G", par: 4, hcp: 6  },
    { h: 12, yds: 281, tee: "R", par: 4, hcp: 12 },
    { h: 13, yds: 330, tee: "R", par: 4, hcp: 14 },
    { h: 14, yds: 152, tee: "R", par: 3, hcp: 18 },
    { h: 15, yds: 498, tee: "R", par: 5, hcp: 2  },
    { h: 16, yds: 506, tee: "R", par: 5, hcp: 10 },
    { h: 17, yds: 177, tee: "R", par: 3, hcp: 16 },
    { h: 18, yds: 400, tee: "G", par: 4, hcp: 8  },
  ],
};

const TEE_LABEL = { R: "▲ Rust", G: "▼ Gold" };

// Team colors double as odds-chart lines, so they're tuned to stay distinguishable
// (incl. red/green colorblindness) when the lines cross.
const TEAMS = {
  billy: {
    id: "billy",
    name: "Team Billy",
    color: "#2563eb",
    pw: "billy",
    players: ["Billy", "Jonny Hwang", "Logan Jacobson", "Adrian Chan"],
  },
  jordan: {
    id: "jordan",
    name: "Team Jordan",
    color: "#059669",
    pw: "jordan",
    players: ["Jordan", "Benjamin Morgan", "Leo Chen", "Adam Jacobson"],
  },
  zach: {
    id: "zach",
    name: "Team Zach",
    color: "#eaa00c",
    pw: "zach",
    players: ["Zach", "Robby Gross", "Albert Byun", "Danny K"],
  },
  stephen: {
    id: "stephen",
    name: "Team Stephen",
    color: "#b91c1c",
    pw: "stephen",
    players: ["Stephen", "Bryce Dacus", "George Tang", "Nick Campbell"],
  },
};

const TEAM_ORDER = ["billy", "jordan", "zach", "stephen"];

// Format / requirement rules (scramble)
const RULES = {
  drivesRequired: 2,     // per player; a par-3 tee shot may count as a drive OR a 2nd shot (one, not both)
  secondsRequired: 2,    // per player; par 3s count (tee shot, if not used as a drive)
  puttsRequired: 2,      // first putts per player, ball must be on the green
};

// ── Side-bet pools ──
// Play money, pari-mutuel: every bet on a market goes into one pot, and the pot is split
// among whoever backed the winner in proportion to their stakes. No house — every Bend Buck
// won is one someone else lost. Contest holes are defaults; the organizer team can change
// them in the app.
const MARKET = {
  currency: "Bend Bucks",
  symbol: "🪙",
  bankroll: 10, // per player, whole bucks
  organizer: "billy",
  markets: [
    {
      id: "winner",
      type: "team",
      icon: "🏆",
      title: "Who wins the 11th BSL Bend Open?",
      short: "18-hole winner",
      closesAfterHoles: 9,
      desc: "Lowest 18-hole team total. Betting closes at the turn (once any group has played 9). Ties go to matching cards (back 9, last 6, last 3, 18th), then the pot is split.",
    },
    {
      id: "longdrive",
      type: "contest",
      best: "max",
      unit: "yds",
      icon: "💣",
      title: "Who wins long drive?",
      short: "Long drive",
      hole: 16,
      noneLabel: "Nobody in the fairway",
      desc: "All 16 players. Each group records its longest drive in the fairway; longest wins, ties split. Betting closes when the first group reaches the hole.",
    },
    {
      id: "ctp",
      type: "contest",
      best: "min",
      unit: "ft",
      icon: "🎯",
      title: "Who wins closest to the pin?",
      short: "Closest to the pin",
      hole: 14,
      noneLabel: "Nobody on the green",
      desc: "All 16 players. Each group records its closest tee shot on the green; closest wins, ties split. Betting closes when the first group reaches the hole.",
    },
    {
      id: "eagle",
      type: "yesno",
      icon: "🦅",
      title: "Will anyone card an eagle (or better)?",
      short: "Eagle watch",
      closesAfterHoles: 9,
      desc: "Settles YES the moment any team posts an eagle or better, NO if nobody has after 18. Betting closes at the turn.",
    },
  ],
};
