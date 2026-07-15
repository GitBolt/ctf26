const PLACES = Object.freeze({
  concourse: Object.freeze({
    title: "Grand Central",
    text: "The last departures board is frozen at 1999. The fare kiosk still glows. East: Signal Room. Below: Red Line.",
  }),
  kiosk: Object.freeze({
    title: "Fare Kiosk",
    text: "A tap-card printer accepts any lowercase route name. A faded label says: ONE ROUTE, ONE SEED.",
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
  ["grand", "concourse"], ["central", "concourse"], ["concourse", "concourse"],
  ["kiosk", "kiosk"], ["fare", "kiosk"],
  ["lost", "lost"], ["lost-and-found", "lost"],
  ["signal", "signal"], ["signals", "signal"],
  ["red", "red"], ["red-line", "red"], ["platform", "red"],
  ["terminus", "terminus"],
]);

export function initialState() {
  return { location: "concourse", actions: [], hints: 0, solved: false, commands: [] };
}

export function describe(state) {
  const place = PLACES[state.location] || PLACES.concourse;
  const exits = state.location === "concourse"
    ? "Exits: kiosk, lost, signal, red"
    : state.location === "terminus"
      ? "There is nowhere else you need to go."
      : "Exit: concourse";
  return `\x1b[1;31m${place.title}\x1b[0m\n${place.text}\n${exits}`;
}

export function mapText(state) {
  const open = state.actions.some((action) => action.type === "enter") ? "OPEN" : "CLOSED";
  return [
    "                         [ Signal Room ]",
    "                                |",
    "[ Lost & Found ] -- [ Grand Central ] -- [ Fare Kiosk ]",
    "                                |",
    `                         [ Red Line: ${open} ]`,
    open ? "                                |\n                          [ Terminus ]" : "",
  ].filter(Boolean).join("\n");
}

export function helpText() {
  return [
    "look                 describe where you are",
    "map                  show the station",
    "go <place>           move through the station",
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
    "Compare how the Fare Kiosk and Signal Room describe a card address.",
    "A Solana PDA hashes seed bytes in order; it does not encode the boundary between adjacent seeds.",
    "What one route word has the same bytes as the two words red + terminus? Buy that card, then tap it.",
  ][Math.min(Math.max(level, 0), 2)];
}

export function parseCommand(line) {
  const normalized = String(line || "").trim().toLowerCase();
  if (!normalized) return { command: "" };
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
