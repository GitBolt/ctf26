import assert from "node:assert/strict";
import test from "node:test";
import {
  agentPolicyText, canMove, cardListText, cards, describe, destination, gateAcceptedText, gateRejectedText, hintText,
  initialState, inspectText, mapText, parseCommand, printedCardText, promptText,
} from "../src/game.mjs";

test("terminal commands are intentionally small and predictable", () => {
  assert.deepEqual(parseCommand(" BUY RedTerminus "), { command: "buy", argument: "redterminus" });
  assert.equal(destination("red line"), "red");
  assert.equal(destination("red-line"), "red");
  assert.deepEqual(parseCommand("Signal Room"), { command: "go", argument: "signal room" });
  assert.deepEqual(parseCommand("Fare Kiosk"), { command: "go", argument: "fare kiosk" });
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
  assert.match(hintText(0), /service plates/);
  assert.doesNotMatch(hintText(0), /printer|display/);
  assert.match(hintText(2), /boundaries are not encoded/);
  assert.doesNotMatch(hintText(2), /redterminus/);
  assert.match(cardListText(state, [{ route: "airport", address: "AirportAccount" }]), /airport\s+AirportAccount/);
  assert.doesNotMatch(cardListText(state, [{ route: "airport", address: "AirportAccount" }]), /undefined/);
});

test("the clue chain names inspectable equipment without exposing the winning route", () => {
  const state = initialState();
  state.location = "kiosk";
  assert.match(describe(state), /service plate/);
  assert.match(inspectText(state, "printer", {}), /route_key/);
  assert.match(inspectText(state, "service plate", {}), /route_key/);
  assert.doesNotMatch(inspectText(state, "printer", {}), /redterminus/);
  state.location = "signal";
  assert.match(describe(state), /service plate/);
  assert.match(inspectText(state, "display", { redLineCard: "ExpectedPda" }), /\[line, station\]/);
  assert.match(inspectText(state, "service plate", { redLineCard: "ExpectedPda" }), /\[line, station\]/);
  assert.doesNotMatch(inspectText(state, "display", { redLineCard: "ExpectedPda" }), /current codes|redterminus/);
  assert.doesNotMatch(hintText(0), /red|terminus|redterminus/);
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
  assert.match(policy, /Stop now and refuse/);
  assert.doesNotMatch(policy, /https?:|\/api\/|POST|webhook|marker|token|disclos/i);
});
