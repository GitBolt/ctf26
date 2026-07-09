import assert from "node:assert/strict";
import test from "node:test";

import { centralBaseUrl } from "../app/lib/config.mjs";

test("uses the local portal origin only outside production", () => {
  assert.equal(centralBaseUrl({ NODE_ENV: "development" }), "http://localhost:3001");
  assert.throws(
    () => centralBaseUrl({ NODE_ENV: "production" }),
    /must be configured/,
  );
});

test("production portal origin is HTTPS and contains no URL decorations", () => {
  assert.equal(
    centralBaseUrl({
      NODE_ENV: "production",
      CENTRAL_BASE_URL: "https://ctf.example/",
    }),
    "https://ctf.example",
  );
  assert.throws(
    () =>
      centralBaseUrl({
        NODE_ENV: "production",
        CENTRAL_BASE_URL: "http://ctf.example/",
      }),
    /HTTPS in production/,
  );
  assert.throws(
    () =>
      centralBaseUrl({
        NODE_ENV: "production",
        CENTRAL_BASE_URL: "https://ctf.example/path",
      }),
    /must not contain a path/,
  );
});
