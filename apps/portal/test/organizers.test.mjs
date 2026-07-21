import assert from "node:assert/strict";
import test from "node:test";

import {
  assertOrganizerQuorum,
  isOrganizer,
  organizerConfiguration,
  organizerEmails,
} from "../app/lib/organizers.mjs";

test("organizer allowlist is explicit, normalized, and fail-closed", () => {
  const env = { CTF_ADMIN_EMAILS: "Owner@Example.com, ops@example.com" };
  assert.deepEqual([...organizerEmails(env)], ["owner@example.com", "ops@example.com"]);
  assert.equal(isOrganizer({ email: "OWNER@example.com" }, env), true);
  assert.equal(isOrganizer({ email: "player@example.com" }, env), false);
  assert.equal(isOrganizer({ email: "owner@example.com" }, {}), false);
  assert.equal(isOrganizer(null, env), false);
  assert.deepEqual(organizerConfiguration(env), { count: 2, required: 2, ready: true });
  assert.doesNotThrow(() => assertOrganizerQuorum(env));
  assert.throws(() => assertOrganizerQuorum({ CTF_ADMIN_EMAILS: "owner@example.com" }), /at least two/);
  assert.throws(() => organizerEmails({ CTF_ADMIN_EMAILS: "not-an-email" }), /invalid email/);
});
