import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("the distributable package satisfies its structural contract", () => {
  const validator = fileURLToPath(new URL("../scripts/validate-package.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [validator], { encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.match(result.stdout, /package validation passed/i);
});

test("PostToolUse observes every supported canonical tool path", async () => {
  const hooksPath = fileURLToPath(new URL("../hooks/hooks.json", import.meta.url));
  const manifest = JSON.parse(await readFile(hooksPath, "utf8"));
  assert.equal(manifest.hooks.PostToolUse[0].matcher, "*");
});
