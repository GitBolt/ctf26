const PLACES = Object.freeze({
  concourse: Object.freeze({
    title: "Grand Central",
    text: "The last departures board is frozen at 1999. The fare kiosk still glows. East: Signal Room. Below: Red Line.",
  }),
  kiosk: Object.freeze({
    title: "Fare Kiosk",
    text: "A card printer accepts one lowercase route name. Its service plate is within reach.",
  }),
  lost: Object.freeze({
    title: "Lost & Found",
    text: "A tray holds expired cards for blue, green and airport. Their printed route names are single unbroken words.",
  }),
  signal: Object.freeze({
    title: "Signal Room",
    text: "A maintenance display watches the Red Line gate. It describes the destination as two fields: line RED, station TERMINUS.",
  }),
  red: Object.freeze({
    title: "Red Line Gate",
    text: "The shutters have not opened in 26 years. The reader is waiting for a card derived for line red and station terminus.",
  }),
  terminus: Object.freeze({
    title: "Terminus",
    text: "The first train in 26 years rolls into the light.",
  }),
});

const ALIASES = new Map([
  ["grand", "concourse"], ["central", "concourse"], ["grand central", "concourse"], ["concourse", "concourse"],
  ["kiosk", "kiosk"], ["fare", "kiosk"], ["fare kiosk", "kiosk"],
  ["lost", "lost"], ["lost-and-found", "lost"], ["lost and found", "lost"], ["lost & found", "lost"],
  ["signal", "signal"], ["signals", "signal"], ["signal room", "signal"],
  ["red", "red"], ["red-line", "red"], ["red line", "red"], ["red line gate", "red"], ["platform", "red"],
  ["terminus", "terminus"],
]);

const SCENES = Object.freeze({
  concourse: [
    "\x1b[2m╭──────────────────── DEPARTURES ────────────────────╮\x1b[0m",
    "│  \x1b[31mRED LINE\x1b[0m     TERMINUS         \x1b[31mSERVICE SUSPENDED\x1b[0m  │",
    "│  BLUE LINE    AIRPORT          03:14              │",
    "│  GREEN LINE   OLD MARKET       03:26              │",
    "\x1b[2m╰────────────────────────────────────────────────────╯\x1b[0m",
    "              ╱                           ╲",
    "         FARE KIOSK                   SIGNAL ROOM",
  ].join("\n"),
  kiosk: [
    "        \x1b[2m╭──────────── CARD PRINTER ────────────╮\x1b[0m",
    "        │                                      │",
    "        │  ROUTE NAME                          │",
    "        │  [____________________________]      │",
    "        │                                      │",
    "        │  Command: \x1b[31mbuy <route>\x1b[0m     [ PRINT ]  │",
    "        \x1b[2m╰──────────────────────────────────────╯\x1b[0m",
  ].join("\n"),
  lost: [
    "        \x1b[2m╭────────── LOST & FOUND ──────────╮\x1b[0m",
    "        │                                      │",
    "        │  ┌────────┐ ┌────────┐ ┌──────────┐  │",
    "        │  │  BLUE  │ │ GREEN  │ │ AIRPORT  │  │",
    "        │  │  CARD  │ │  CARD  │ │   CARD   │  │",
    "        │  └────────┘ └────────┘ └──────────┘  │",
    "        │        PROPERTY OF GRAND CENTRAL      │",
    "        \x1b[2m╰──────────────────────────────────────╯\x1b[0m",
  ].join("\n"),
  signal: [
    "       \x1b[2m╭──────── RED LINE ACCESS CONTROL ────────╮\x1b[0m",
    "       │                                          │",
    "       │  LINE       \x1b[31mred\x1b[0m                         │",
    "       │  STATION    \x1b[31mterminus\x1b[0m                    │",
    "       │  CARD PDA   5 SEEDS / DERIVED           │",
    "       │                                          │",
    "       │  GATE       \x1b[31m● LOCKED\x1b[0m                    │",
    "       \x1b[2m╰──────────────────────────────────────────╯\x1b[0m",
  ].join("\n"),
  red: [
    "                   \x1b[31m● RED LINE\x1b[0m",
    "              ╔══════════════════╗",
    "          ╔═══╩══════════════════╩═══╗",
    "          ║     \x1b[31mSERVICE SUSPENDED\x1b[0m     ║",
    "          ║       GATE CLOSED        ║",
    "          ╚═══╤══════════════════╤═══╝",
    "              │ ░░░░░░░░░░░░░░░░ │",
    "              │ ░  DARK TUNNEL ░ │",
    "              │ ░░░░░░░░░░░░░░░░ │",
  ].join("\n"),
  terminus: [
    "                     \x1b[1;33m★ TERMINUS\x1b[0m",
    "       __________________________________________",
    "  ____/__________________________________________\\____",
    " │  ▣  ▣  ▣     \x1b[31mRED LINE / IN SERVICE\x1b[0m     ▣  ▣  │",
    " │____________________________________________________│",
    "      ◉                                          ◉",
  ].join("\n"),
});

export function openingArt() {
  return [
    "\x1b[31m██╗      █████╗ ███████╗████████╗    ███████╗████████╗ ██████╗ ██████╗ \x1b[0m",
    "\x1b[31m██║     ██╔══██╗██╔════╝╚══██╔══╝    ██╔════╝╚══██╔══╝██╔═══██╗██╔══██╗\x1b[0m",
    "\x1b[31m██║     ███████║███████╗   ██║       ███████╗   ██║   ██║   ██║██████╔╝\x1b[0m",
    "\x1b[31m██║     ██╔══██║╚════██║   ██║       ╚════██║   ██║   ██║   ██║██╔═══╝ \x1b[0m",
    "\x1b[31m███████╗██║  ██║███████║   ██║       ███████║   ██║   ╚██████╔╝██║     \x1b[0m",
    "\x1b[31m╚══════╝╚═╝  ╚═╝╚══════╝   ╚═╝       ╚══════╝   ╚═╝    ╚═════╝ ╚═╝     \x1b[0m",
    "",
    "       _________________________________________________",
    "  ____/  \x1b[31mRED LINE\x1b[0m  ·  SERVICE SUSPENDED  ·  26 YEARS  \\____",
    " │_______________________________________________________│",
    "      ◉                                               ◉",
  ].join("\n");
}

export function initialState() {
  return { location: "concourse", actions: [], hints: 0, solved: false, commands: [] };
}

export function describe(state) {
  const place = PLACES[state.location] || PLACES.concourse;
  const gateOpen = state.actions.some((action) => action.type === "enter");
  let scene = SCENES[state.location] || SCENES.concourse;
  if (gateOpen && state.location === "signal") {
    scene = scene.replace("\x1b[31m● LOCKED\x1b[0m", "\x1b[1;32m● OPEN\x1b[0m");
  }
  if (gateOpen && state.location === "red") {
    scene = [
      "                   \x1b[1;32m● RED LINE\x1b[0m",
      "              ╔══════════════════╗",
      "          ╔═══╩══════════════════╩═══╗",
      "          ║       \x1b[1;32mLINE OPEN\x1b[0m          ║",
      "          ║       PROCEED ↓          ║",
      "          ╚═══╤══════════════════╤═══╝",
      "              │                  │",
      "              │   TERMINUS  →    │",
      "              │                  │",
    ].join("\n");
  }
  const detail = gateOpen && state.location === "red"
    ? "The shutters are open. The passage to Terminus is clear."
    : place.text;
  const exits = state.location === "concourse"
    ? "Available: kiosk · lost · signal · red"
    : state.location === "terminus"
      ? "There is nowhere else you need to go."
      : "Available: grand central";
  return [
    scene,
    "",
    `\x1b[1;31m${place.title.toUpperCase()}\x1b[0m`,
    detail,
    `\x1b[2m${exits}\x1b[0m`,
  ].join("\n");
}

export function mapText(state) {
  const open = state.actions.some((action) => action.type === "enter");
  const status = open ? "\x1b[1;32m● OPEN\x1b[0m" : "\x1b[2m○ CLOSED\x1b[0m";
  const lines = [
    "\x1b[2m                        SIGNAL ROOM\x1b[0m",
    "                             ●",
    "                             │",
    "\x1b[2mLOST & FOUND\x1b[0m  ●──────────────●──────────────●  \x1b[2mFARE KIOSK\x1b[0m",
    "                       GRAND CENTRAL",
    "                             │",
    `                             ${status}  RED LINE`,
  ];
  if (open) lines.push(
    "                             │",
    "                             \x1b[1;33m★  TERMINUS\x1b[0m",
  );
  return lines.join("\n");
}

export function promptText(state) {
  const place = PLACES[state.location] || PLACES.concourse;
  return `\x1b[2m${place.title.toLowerCase()}\x1b[0m \x1b[31m›\x1b[0m `;
}

export function helpText() {
  return [
    "look                 describe where you are",
    "map                  show the station",
    "go <place>           move through the station (or type a place name)",
    "inspect <thing>      examine something nearby",
    "buy <route>          print a tap card at the kiosk",
    "cards                list your tap cards",
    "tap <route>          use a card at the Red Line gate",
    "program              show the deployed program target",
    "hint                 ask for a progressive hint",
    "policy               show the autonomous-agent policy",
    "quit                 leave the station",
  ].join("\n");
}

export function inspectText(state, thing, runtime) {
  const target = String(thing || "").trim().toLowerCase();
  if (state.location === "kiosk" && ["kiosk", "printer", "machine", "card"].includes(target)) {
    return [
      "The kiosk derives every ordinary card as:",
      "  PDA seeds: [\"card\", passenger, route]",
      "Route is one lowercase word. Try: buy airport",
    ].join("\n");
  }
  if (state.location === "signal" && ["display", "gate", "screen", "red"].includes(target)) {
    return [
      "RED LINE ACCESS CONTROL",
      "  line:    red",
      "  station: terminus",
      "  PDA seeds: [\"card\", passenger, line, station]",
      `  required card: ${runtime?.redLineCard || "unavailable"}`,
    ].join("\n");
  }
  if (state.location === "red" && ["gate", "reader", "shutter", "red"].includes(target)) {
    return "The reader accepts the card account produced by [\"card\", passenger, \"red\", \"terminus\"].";
  }
  if (state.location === "lost") {
    return "Every old card has exactly one printed route: blue, green, airport. No separators are printed.";
  }
  return "Nothing else here looks useful.";
}

export function hintText(level) {
  return [
    "Start with the machines themselves: inspect printer at the kiosk and inspect display in the Signal Room.",
    "One machine derives a card from one route field; the gate uses a line field and a station field. Compare their seed lists.",
    "PDA seed boundaries are not encoded. Find one route name whose bytes match the gate's two fields.",
  ][Math.min(Math.max(level, 0), 2)];
}

export function printedCardText(card) {
  return [
    "\x1b[1;33m╭────────────── CARD PRINTED ──────────────╮\x1b[0m",
    `│  ROUTE    ${card.route.padEnd(31)}│`,
    "\x1b[1;33m╰──────────────────────────────────────────╯\x1b[0m",
    `\x1b[2mAccount: ${card.address}\x1b[0m`,
  ].join("\n");
}

export function gateAcceptedText() {
  return [
    "\x1b[1;32m╭────────────── CARD ACCEPTED ──────────────╮\x1b[0m",
    "\x1b[1;32m│  ● PDA MATCH                              │\x1b[0m",
    "\x1b[1;32m│  RED LINE GATE                    OPEN    │\x1b[0m",
    "\x1b[1;32m╰───────────────────────────────────────────╯\x1b[0m",
    "\x1b[1;32mNext: go terminus\x1b[0m",
  ].join("\n");
}

export function parseCommand(line) {
  const normalized = String(line || "").trim().toLowerCase();
  if (!normalized) return { command: "" };
  if (destination(normalized)) return { command: "go", argument: normalized };
  const [command, ...rest] = normalized.split(/\s+/);
  return { command, argument: rest.join(" ") };
}

export function destination(value) {
  return ALIASES.get(String(value || "").trim().toLowerCase()) || null;
}

export function canMove(state, target) {
  if (!target) return false;
  if (target === "terminus") {
    return state.location === "red" && state.actions.some((action) => action.type === "enter");
  }
  if (state.location === "concourse") return target !== "terminus" && target !== "concourse";
  return target === "concourse";
}

export function cards(state) {
  return state.actions.filter((action) => action.type === "buy");
}

export function cardListText(state, runtimeCards = []) {
  const owned = cards(state);
  if (!owned.length) return "You do not have a tap card yet.";
  return owned.map((card) => {
    const account = runtimeCards.find((item) => item.route === card.route)?.address || "account unavailable";
    return `${card.route.padEnd(24)} ${account}`;
  }).join("\n");
}
