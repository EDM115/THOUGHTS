import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  classifyPrompt,
  handleEvent,
  initialState,
  readState,
  shouldContinue,
} from "../hooks/thoughts-hook.mjs";

const SESSION = "session/with unsafe characters";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "thoughts-hook-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  return { PLUGIN_DATA: directory };
}

async function send(env, hook_event_name, fields = {}) {
  return handleEvent({ hook_event_name, session_id: SESSION, ...fields }, env);
}

async function persisted(env) {
  const files = await readdir(env.PLUGIN_DATA);
  assert.equal(files.length, 1);
  assert.match(files[0], /^[a-f0-9]{64}\.json$/);
  return JSON.parse(await readFile(join(env.PLUGIN_DATA, files[0]), "utf8"));
}

test("classifies explicit invocations and direct persistence requests without retaining text", () => {
  assert.deepEqual(classifyPrompt("Please use $thoughts cleanup"), {
    explicit: true,
    largeScope: false,
  });
  assert.equal(classifyPrompt("write this to docs/THOUGHTS.md").explicit, true);
  assert.equal(classifyPrompt("thoughts init").explicit, true);
});

test("large-scope language needs at least one tool call", () => {
  const signal = classifyPrompt("Plan and implement a multi-step architecture migration");
  assert.equal(classifyPrompt("Plan the release across several packages").largeScope, true);
  const state = { ...initialState(), ...signal };
  assert.equal(shouldContinue({}, state), false);
  assert.equal(shouldContinue({}, { ...state, toolCount: 1 }), true);
});

test("mechanical thresholds cover mutations, tool volume, delegation, and trivial turns", () => {
  assert.equal(shouldContinue({}, { ...initialState(), mutationCount: 2 }), true);
  assert.equal(shouldContinue({}, { ...initialState(), toolCount: 8 }), true);
  assert.equal(shouldContinue({}, { ...initialState(), delegated: true }), true);
  assert.equal(shouldContinue({}, initialState()), false);
});

test("a turn persists signals only and Stop requests one semantic check", async (t) => {
  const env = await fixture(t);
  const secretPrompt = "Implement a large architecture refactor SECRET-PROMPT";
  const secretTool = "SECRET-TOOL-PAYLOAD C:/private/source.ts";

  await send(env, "UserPromptSubmit", {
    prompt: secretPrompt,
    transcript_path: "C:/private/transcript.jsonl",
    arbitrary: "SECRET-EVENT-FIELD",
  });
  await send(env, "PostToolUse", {
    tool_name: "apply_patch",
    tool_input: { patch: secretTool },
  });
  const output = await send(env, "Stop", {
    last_assistant_message: "SECRET-ASSISTANT-MESSAGE",
  });

  assert.equal(output.decision, "block");
  assert.match(output.reason, /\$thoughts append/);
  const state = await persisted(env);
  assert.deepEqual(Object.keys(state).sort(), Object.keys(initialState()).sort());
  const serialized = JSON.stringify(state);
  for (const forbidden of [secretPrompt, secretTool, "transcript", "private", "SECRET"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("two mutations, eight tools, and delegation trigger Stop independently", async (t) => {
  const mutationEnv = await fixture(t);
  await send(mutationEnv, "UserPromptSubmit", { prompt: "small change" });
  await send(mutationEnv, "PostToolUse", { tool_name: "Edit", tool_input: {} });
  await send(mutationEnv, "PostToolUse", { tool_name: "Write", tool_input: {} });
  assert.equal((await send(mutationEnv, "Stop")).decision, "block");

  const volumeEnv = await fixture(t);
  await send(volumeEnv, "UserPromptSubmit", { prompt: "investigate" });
  for (let index = 0; index < 8; index += 1) {
    await send(volumeEnv, "PostToolUse", { tool_name: "Read", tool_input: { index } });
  }
  assert.equal((await send(volumeEnv, "Stop")).decision, "block");

  const delegateEnv = await fixture(t);
  await send(delegateEnv, "UserPromptSubmit", { prompt: "delegate" });
  await send(delegateEnv, "PostToolUse", { tool_name: "spawn_agent", tool_input: {} });
  assert.equal((await send(delegateEnv, "Stop")).decision, "block");
});

test("Stop skips trivial turns, active stop chains, and turns that touched thoughts", async (t) => {
  const trivialEnv = await fixture(t);
  await send(trivialEnv, "UserPromptSubmit", { prompt: "What is 2 + 2?" });
  assert.deepEqual(await send(trivialEnv, "Stop"), {});

  const activeEnv = await fixture(t);
  await send(activeEnv, "UserPromptSubmit", { prompt: "$thoughts append" });
  assert.deepEqual(await send(activeEnv, "Stop", { stop_hook_active: true }), {});

  const touchedEnv = await fixture(t);
  await send(touchedEnv, "UserPromptSubmit", { prompt: "large refactor" });
  await send(touchedEnv, "PostToolUse", {
    tool_name: "apply_patch",
    tool_input: { path: "docs\\THOUGHTS.md" },
  });
  assert.deepEqual(await send(touchedEnv, "Stop"), {});
});

test("compaction recovery emits once and skips ordinary startup", async (t) => {
  const env = await fixture(t);
  await send(env, "UserPromptSubmit", { prompt: "implement the migration" });
  assert.deepEqual(await send(env, "PreCompact"), {});

  const recovered = await send(env, "SessionStart", { source: "compact" });
  assert.match(recovered.hookSpecificOutput.additionalContext, /\$thoughts append/);
  assert.match(recovered.hookSpecificOutput.additionalContext, /short unrelated/i);
  assert.deepEqual(await send(env, "SessionStart", { source: "compact" }), {});
  assert.deepEqual(await send(env, "SessionStart", { source: "startup" }), {});
});

test("a thoughts write before compaction suppresses recovery", async (t) => {
  const env = await fixture(t);
  await send(env, "UserPromptSubmit", { prompt: "large migration" });
  await send(env, "PostToolUse", {
    tool_name: "Write",
    tool_input: { file_path: "THOUGHTS.md" },
  });
  await send(env, "PreCompact");
  assert.deepEqual(await send(env, "SessionStart", { source: "compact" }), {});
});

test("corrupt state and unavailable persistence fail open", async (t) => {
  const env = await fixture(t);
  await send(env, "UserPromptSubmit", { prompt: "large architecture plan" });
  const [filename] = await readdir(env.PLUGIN_DATA);
  await writeFile(join(env.PLUGIN_DATA, filename), "not json", "utf8");
  assert.deepEqual(await send(env, "Stop"), {});
  assert.deepEqual(await handleEvent({ hook_event_name: "Stop", session_id: SESSION }, {}), {});
  assert.deepEqual(await handleEvent({ hook_event_name: "Stop" }, env), {});
  assert.deepEqual(await readState({}, SESSION), initialState());
});

test("SubagentStart forbids writes and requests candidate reporting only", async (t) => {
  const env = await fixture(t);
  const output = await send(env, "SubagentStart", {
    agent_id: "worker-1",
    agent_type: "Explore",
  });
  const context = output.hookSpecificOutput.additionalContext;
  assert.match(context, /must never edit `?THOUGHTS\.md`?/i);
  assert.match(context, /Thought candidates/);
  assert.match(context, /substantial/i);
});

test("the command entrypoint accepts events and fails open on invalid stdin", () => {
  const script = fileURLToPath(new URL("../hooks/thoughts-hook.mjs", import.meta.url));
  const invalid = spawnSync(process.execPath, [script], { input: "not json", encoding: "utf8" });
  assert.equal(invalid.status, 0);
  assert.deepEqual(JSON.parse(invalid.stdout), {});

  const valid = spawnSync(process.execPath, [script], {
    input: JSON.stringify({ hook_event_name: "Stop", session_id: "missing-data-dir" }),
    encoding: "utf8",
  });
  assert.equal(valid.status, 0);
  assert.deepEqual(JSON.parse(valid.stdout), {});
});
