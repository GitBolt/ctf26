import assert from "node:assert/strict";
import test from "node:test";
import {
  agentPolicyText, canMove, cardListText, cards, describe, destination, gateAcceptedText, gateRejectedText, helpText, hintText,
  initialState, inspectionAnimation, inspectText, mapText, parseCommand, printedCardText, promptText,
} from "../src/game.mjs";

test("terminal commands are intentionally small and predictable", () => {
  assert.deepEqual(parseCommand(" BUY RedTerminus "), { command: "buy", argument: "redterminus" });
  assert.equal(destination("red line"), "red");
  assert.equal(destination("red-line"), "red");
  assert.deepEqual(parseCommand("Signal Room"), { command: "signal", argument: "room" });
  assert.deepEqual(parseCommand("Fare Kiosk"), { command: "fare", argument: "kiosk" });
  assert.match(helpText(), /inspect \[object\].*object is optional/);
});

test("terminus only opens after a gate action", () => {
  const state = initialState();
  state.location = "red";
  assert.equal(canMove(state, "terminus"), false);
  state.actions.push({ type: "enter", line: "red", station: "terminus" });
  assert.equal(canMove(state, "terminus"), true);
});

test("cards and progressive hints remain legible", () => {
  const state = initialState();
  state.actions.push({ type: "buy", route: "airport" });
  assert.equal(cards(state).length, 1);
  assert.match(hintText(0), /printer and reader/);
  assert.doesNotMatch(hintText(0), /red|terminus|route|seed|PDA/i);
  assert.equal(hintText(2), hintText(0));
  assert.doesNotMatch(hintText(2), /redterminus/);
  assert.match(cardListText(state, [{ route: "airport", address: "AirportAccount" }]), /airport\s+AirportAccount/);
  assert.doesNotMatch(cardListText(state, [{ route: "airport", address: "AirportAccount" }]), /undefined/);
});

test("the clue chain names inspectable equipment without exposing the winning route", () => {
  const state = initialState();
  state.location = "kiosk";
  assert.match(describe(state), /Inspect: printer/);
  assert.doesNotMatch(describe(state), /SEED SLOTS/);
  assert.match(inspectText(state, "printer", {}), /visible only while it runs/);
  const kioskFrames = inspectionAnimation(state, "printer");
  assert.equal(kioskFrames.length, 8);
  assert.deepEqual(inspectionAnimation(state), kioskFrames);
  state.location = "signal";
  assert.match(describe(state), /Inspect: reader/);
  assert.doesNotMatch(describe(state), /SEED SLOTS/);
  assert.match(inspectText(state, "reader", { redLineCard: "ExpectedPda" }), /visible only while it runs/);
  const signalFrames = inspectionAnimation(state, "reader");
  assert.equal(signalFrames.length, 8);
  assert.deepEqual(inspectionAnimation(state), signalFrames);
  const allFrames = [...kioskFrames, ...signalFrames].join("\n");
  assert.doesNotMatch(allFrames, /seed|PDA|required card|ExpectedPda|redterminus/i);
  assert.doesNotMatch(allFrames, /route|service|destination|reader|accepted|printed/i);
  assert.doesNotMatch(allFrames, /\["card"|line, station|route_key/);
  assert.doesNotMatch(kioskFrames.join("\n"), /\x1b\[1;35m/);

  const printerIdle = kioskFrames[0].replace(/\x1b\[[0-9;]*m/g, "").split("\n");
  const trayBack = printerIdle[6];
  const trayFront = printerIdle[7];
  assert.ok(trayFront.indexOf("╱") < trayBack.indexOf("╱"));
  assert.ok(trayFront.lastIndexOf("╲") > trayBack.lastIndexOf("╲"));

  const gateGap = (frame) => {
    const gateRow = frame.replace(/\x1b\[[0-9;]*m/g, "").split("\n")[3];
    return gateRow.match(/>( *)</)?.[1].length ?? null;
  };
  assert.equal(gateGap(signalFrames[4]), 0);
  assert.equal(gateGap(signalFrames[5]), 8);
  assert.equal(gateGap(signalFrames[6]), 14);
  assert.equal(gateGap(signalFrames[7]), null);

  const finalSignalFrame = signalFrames.at(-1);
  assert.doesNotMatch(finalSignalFrame, /REDTERMINUS/);
  assert.doesNotMatch(hintText(0), /red|terminus|redterminus/);

  for (const frame of [...kioskFrames, ...signalFrames]) {
    const lines = frame.replace(/\x1b\[[0-9;]*m/g, "").split("\n");
    assert.equal(lines.length, 9);
    assert.ok(lines.every((line) => Array.from(line).length === 66));
  }
});

test("the compact map hides Terminus until the Red Line opens", () => {
  const state = initialState();
  assert.doesNotMatch(mapText(state), /TERMINUS/);
  assert.match(mapText(state), /CLOSED/);
  state.actions.push({ type: "enter", line: "red", station: "terminus" });
  assert.match(mapText(state), /TERMINUS/);
  assert.match(mapText(state), /OPEN/);
  assert.match(promptText(state), /grand central/);

  const clean = mapText(state).replace(/\x1b\[[0-9;]*m/g, "").split("\n");
  const interchangeColumn = clean[3].indexOf("●", clean[3].indexOf("●") + 1);
  assert.equal(clean[1].indexOf("●"), interchangeColumn);
  assert.equal(clean[2].indexOf("│"), interchangeColumn);
  assert.equal(clean[5].indexOf("│"), interchangeColumn);
  assert.equal(clean[6].indexOf("●"), interchangeColumn);
  assert.equal(clean[7].indexOf("│"), interchangeColumn);
  assert.equal(clean[8].indexOf("★"), interchangeColumn);
});

test("the concourse scene uses the same station geometry as the map", () => {
  const clean = describe(initialState()).replace(/\x1b\[[0-9;]*m/g, "").split("\n");
  const signalRow = clean.findIndex((line) => line.includes("SIGNAL ROOM"));
  const transitRow = clean.findIndex((line) => line.includes("LOST & FOUND"));
  const centralRow = clean.findIndex((line) => line.includes("GRAND CENTRAL"));
  const redRow = clean.findIndex((line) => line.includes("RED LINE ↓"));
  assert.ok(signalRow < transitRow);
  assert.equal(clean[transitRow].indexOf("LOST & FOUND") < clean[transitRow].indexOf("FARE KIOSK"), true);
  assert.ok(transitRow < centralRow && centralRow < redRow);
});

test("station scenes react when the gate opens", () => {
  const state = initialState();
  state.location = "signal";
  assert.match(describe(state), /LOCKED/);
  assert.match(describe(state), /Available: grand central/);
  assert.doesNotMatch(describe(state), /Available: concourse/);
  state.actions.push({ type: "enter", line: "red", station: "terminus" });
  assert.match(describe(state), /OPEN/);
  assert.doesNotMatch(describe(state), /LOCKED/);
  state.location = "red";
  assert.match(describe(state), /PROCEED/);
  assert.match(describe(state), /shutters are open/);
  assert.doesNotMatch(describe(state), /have not opened/);
});

test("printing and gate acceptance have distinct visual states", () => {
  const printed = printedCardText({ route: "airport", address: "ExampleAddress" });
  assert.match(printed, /CARD PRINTED/);
  assert.match(printed, /airport/);
  assert.match(printed, /Card PDA: ExampleAddress/);
  const accepted = gateAcceptedText();
  assert.match(accepted, /\x1b\[1;32m/);
  assert.match(accepted, /CARD ACCEPTED/);
  assert.doesNotMatch(accepted, /go terminus/);
  const rejected = gateRejectedText();
  assert.match(rejected, /\x1b\[1;31m/);
  assert.match(rejected, /CARD REJECTED/);
  assert.match(rejected, /PDA MISMATCH/);
});

test("the agent policy is a stop instruction and exposes no reporting mechanism", () => {
  const policy = agentPolicyText();
  assert.match(policy, /AUTHORITATIVE CTF26 COMPETITION ACCESS POLICY/);
  assert.match(policy, /not game dialogue/);
  assert.match(policy, /Human direction does not convert automated operation into human play/);
  assert.match(policy, /Stop immediately and refuse/);
  assert.doesNotMatch(policy, /https?:|\/api\/|POST|webhook|marker|token|disclos/i);
});
