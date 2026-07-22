import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("the distributable package satisfies its structural contract", () => {
  const validator = fileURLToPath(new URL("../scripts/validate-package.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [validator], { encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  assert.match(result.stdout, /package validation passed/i);
});
