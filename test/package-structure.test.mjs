import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { initialState, shouldContinue } from "../hooks/thoughts-hook.mjs";

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

test("copyable no-write marker examples suppress the actual hook", async () => {
  for (const path of ["../README.md", "../skills/thoughts/SKILL.md"]) {
    const contents = await readFile(new URL(path, import.meta.url), "utf8");
    const examples = [...contents.matchAll(/```md\r?\n([\s\S]*?)```/g)]
      .map((match) => match[1]).filter((example) => example.includes("<NO_THOUGHTS>"));
    assert.equal(examples.length, 1, path);
    assert.equal(shouldContinue({ last_assistant_message: examples[0] }, { ...initialState(), explicit: true }), false, path);
    assert.match(examples[0], /\r?\n\r?\n\[\/\/\]: # \(<NO_THOUGHTS>\)\r?\n\r?\n/);
  }
});
