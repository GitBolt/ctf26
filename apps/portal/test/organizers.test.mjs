import assert from "node:assert/strict";
import test from "node:test";

import { isOrganizer, organizerEmails } from "../app/lib/organizers.mjs";

test("organizer allowlist is explicit, normalized, and fail-closed", () => {
  const env = { CTF_ADMIN_EMAILS: "Owner@Example.com, ops@example.com" };
  assert.deepEqual([...organizerEmails(env)], ["owner@example.com", "ops@example.com"]);
  assert.equal(isOrganizer({ email: "OWNER@example.com" }, env), true);
  assert.equal(isOrganizer({ email: "player@example.com" }, env), false);
  assert.equal(isOrganizer({ email: "owner@example.com" }, {}), false);
  assert.equal(isOrganizer(null, env), false);
});
