import assert from "node:assert/strict";
import test from "node:test";

import { eventTarget } from "../lib/target-config.mjs";

const vault = "11111111111111111111111111111111";

test("requires an exact canonical target and a net-drain threshold", () => {
  const target = eventTarget({
    IMPRINT_TARGET_VAULT: vault,
    NEXT_PUBLIC_TARGET_VAULT: vault,
    IMPRINT_INITIAL_TARGET_LAMPORTS: "501579920",
    IMPRINT_MINIMUM_DRAIN_LAMPORTS: "450000000",
  });
  assert.equal(target.vault.toString(), vault);
  assert.equal(target.initialLamports, 501579920n);
  assert.equal(target.minimumDrainLamports, 450000000n);
});

test("rejects a client-visible target that disagrees with the checker target", () => {
  assert.throws(
    () => eventTarget({
      IMPRINT_TARGET_VAULT: vault,
      NEXT_PUBLIC_TARGET_VAULT: "SysvarC1ock11111111111111111111111111111111",
      IMPRINT_INITIAL_TARGET_LAMPORTS: "10",
      IMPRINT_MINIMUM_DRAIN_LAMPORTS: "11",
    }),
    /NEXT_PUBLIC_TARGET_VAULT must match/,
  );
});
