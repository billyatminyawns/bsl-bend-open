// ── 11th BSL Bend Open · Pronghorn Nicklaus · Rust Tees ──
// Course data transcribed from the official Pronghorn Club scorecard (02/23)

const COURSE = {
  name: "Pronghorn Club · Nicklaus Course",
  tees: "Rust",
  rating: "70.8 / 138",
  totalYards: 6533,
  totalPar: 72,
  holes: [
    // hole, yards, par, hcp (men's)
    { h: 1,  yds: 355, par: 4, hcp: 17 },
    { h: 2,  yds: 524, par: 5, hcp: 7  },
    { h: 3,  yds: 203, par: 3, hcp: 11 },
    { h: 4,  yds: 300, par: 4, hcp: 15 },
    { h: 5,  yds: 400, par: 4, hcp: 9  },
    { h: 6,  yds: 445, par: 4, hcp: 3  },
    { h: 7,  yds: 137, par: 3, hcp: 13 },
    { h: 8,  yds: 589, par: 5, hcp: 1  },
    { h: 9,  yds: 392, par: 4, hcp: 5  },
    { h: 10, yds: 419, par: 4, hcp: 4  },
    { h: 11, yds: 407, par: 4, hcp: 6  },
    { h: 12, yds: 281, par: 4, hcp: 12 },
    { h: 13, yds: 330, par: 4, hcp: 14 },
    { h: 14, yds: 152, par: 3, hcp: 18 },
    { h: 15, yds: 498, par: 5, hcp: 2  },
    { h: 16, yds: 506, par: 5, hcp: 10 },
    { h: 17, yds: 177, par: 3, hcp: 16 },
    { h: 18, yds: 418, par: 4, hcp: 8  },
  ],
};

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
    color: "#16a34a",
    pw: "jordan",
    players: ["Jordan", "Benjamin Morgan", "Leo Chen", "Adam Jacobson"],
  },
  zach: {
    id: "zach",
    name: "Team Zach",
    color: "#d97706",
    pw: "zach",
    players: ["Zach", "Robby Gross", "Albert Byun", "Danny K"],
  },
  stephen: {
    id: "stephen",
    name: "Team Stephen",
    color: "#dc2626",
    pw: "stephen",
    players: ["Stephen", "Bryce Dacus", "George Tang", "Nick Campbell"],
  },
};

const TEAM_ORDER = ["billy", "jordan", "zach", "stephen"];

// Format / requirement rules (scramble)
const RULES = {
  drivesRequired: 2,     // per player, par 3s do NOT count
  secondsRequired: 2,    // per player, par 3s DO count
  puttsRequired: 2,      // first putts per player, ball must be on the green
};
