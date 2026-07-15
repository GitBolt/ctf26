import assert from "node:assert/strict";
import test from "node:test";
import { canMove, cards, destination, hintText, initialState, parseCommand } from "../src/game.mjs";

test("terminal commands are intentionally small and predictable", () => {
  assert.deepEqual(parseCommand(" BUY RedTerminus "), { command: "buy", argument: "redterminus" });
  assert.equal(destination("red line"), null);
  assert.equal(destination("red-line"), "red");
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
  assert.match(hintText(2), /red \+ terminus/);
});
