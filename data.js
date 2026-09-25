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

// ── Side-action prediction market ──
// Play money only: everyone starts with the same Bend Bucks bankroll and nothing is
// paid out of the app. Prices come from an LMSR market maker; `b` is liquidity —
// higher = odds move less per bet.
const MARKET = {
  currency: "Bend Bucks",
  symbol: "🪙",
  bankroll: 1000,
  markets: [
    {
      id: "winner",
      type: "team",
      title: "Who wins the 11th BSL Bend Open?",
      short: "Tournament winner",
      holes: [1, 18],
      b: 800,
      desc: "Lowest 18-hole team total. Betting closes when the first group finishes 18. Ties go to matching cards (back 9, last 6, last 3, 18th), then split.",
    },
    {
      id: "front9",
      type: "team",
      title: "Who wins the front 9?",
      short: "Front 9",
      holes: [1, 9],
      b: 600,
      desc: "Lowest team score on holes 1–9. Betting closes when the first group finishes the front. Ties: last 6, last 3, 9th hole, then split.",
    },
    {
      id: "eagle",
      type: "eagle",
      title: "Will anyone card an eagle (or better)?",
      short: "Eagle watch",
      holes: [1, 18],
      b: 500,
      desc: "Settles YES the moment any team posts an eagle or better, NO if nobody has by the end. Closes when the first group finishes 18.",
    },
  ],
};
