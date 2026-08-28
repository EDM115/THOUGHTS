import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
    cleanup: true,
  });
  assert.equal(classifyPrompt("write this to docs/THOUGHTS.md").explicit, true);
  assert.equal(classifyPrompt("thoughts init").explicit, true);
  assert.equal(classifyPrompt("Please clean up the prose in THOUGHTS.md").cleanup, false);
});

test("classifies high-signal large-scope language without substring false positives", () => {
  const prompts = [
    "Rewrite and modernize the service",
    "Plan a cross-cutting end-to-end upgrade",
    "Coordinate a system-wide codebase-wide overhaul",
    "Complete a repo-wide large-scale replatform",
    "Handle a multi-file multi-module integration",
    "Prepare a multi-package multi-service multi-repo deployment",
    "Debug the release and write a diagnosis roadmap",
    "Perform performance optimization and security hardening",
    "Draft the implementation specification",
  ];
  for (const prompt of prompts) assert.equal(classifyPrompt(prompt).largeScope, true, prompt);
  assert.equal(classifyPrompt("The upgrader reports its version").largeScope, false);
});

test("large-scope language needs at least five tool calls", () => {
  const signal = classifyPrompt("Plan and implement a multi-step architecture migration");
  assert.equal(classifyPrompt("Plan the release across several packages").largeScope, true);
  const state = { ...initialState(), ...signal };
  assert.equal(shouldContinue({}, state), false);
  assert.equal(shouldContinue({}, { ...state, toolCount: 4 }), false);
  assert.equal(shouldContinue({}, { ...state, toolCount: 5 }), true);
});

test("mechanical thresholds cover mutations, tool volume, delegation and trivial turns", () => {
  assert.equal(shouldContinue({}, { ...initialState(), mutationCount: 3 }), false);
  assert.equal(shouldContinue({}, { ...initialState(), mutationCount: 4 }), true);
  assert.equal(shouldContinue({}, { ...initialState(), toolCount: 9 }), false);
  assert.equal(shouldContinue({}, { ...initialState(), toolCount: 10 }), true);
  assert.equal(shouldContinue({}, { ...initialState(), delegated: true }), true);
  assert.equal(shouldContinue({}, initialState()), false);
});

test("the exact NO_THOUGHTS marker suppresses every Stop trigger without case folding", () => {
  const event = {
    last_assistant_message: "Implemented and verified.\n\n[//]: # (<NO_THOUGHTS>)\n\n",
  };
  const triggeringStates = [
    { ...initialState(), explicit: true },
    { ...initialState(), mutationCount: 4 },
    { ...initialState(), toolCount: 10 },
    { ...initialState(), delegated: true },
    { ...initialState(), compactionPending: true },
    { ...initialState(), largeScope: true, toolCount: 5 },
  ];
  for (const state of triggeringStates) assert.equal(shouldContinue(event, state), false);
  assert.equal(
    shouldContinue(
      { last_assistant_message: "Implemented.\n\n[//]: # (<no_thoughts>)\n\n" },
      { ...initialState(), explicit: true },
    ),
    true,
  );
  assert.equal(
    shouldContinue(
      { last_assistant_message: "Implemented.\n\n[//]: # (<NO_NOTES>)\n\n" },
      { ...initialState(), explicit: true },
    ),
    true,
  );
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
  for (let index = 0; index < 4; index += 1) {
    await send(env, "PostToolUse", {
      tool_name: "apply_patch",
      tool_input: { patch: secretTool, index },
    });
  }
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

test("four mutations, ten tools and delegation trigger Stop independently", async (t) => {
  const mutationEnv = await fixture(t);
  await send(mutationEnv, "UserPromptSubmit", { prompt: "small change" });
  for (let index = 0; index < 4; index += 1) {
    await send(mutationEnv, "PostToolUse", { tool_name: "Edit", tool_input: { index } });
  }
  assert.equal((await send(mutationEnv, "Stop")).decision, "block");

  const volumeEnv = await fixture(t);
  await send(volumeEnv, "UserPromptSubmit", { prompt: "small lookup" });
  for (let index = 0; index < 10; index += 1) {
    await send(volumeEnv, "PostToolUse", { tool_name: "Read", tool_input: { index } });
  }
  assert.equal((await send(volumeEnv, "Stop")).decision, "block");

  const delegateEnv = await fixture(t);
  await send(delegateEnv, "UserPromptSubmit", { prompt: "delegate" });
  await send(delegateEnv, "PostToolUse", { tool_name: "spawn_agent", tool_input: {} });
  assert.equal((await send(delegateEnv, "Stop")).decision, "block");
});

test("Code Mode outer and nested PostToolUse events share canonical accounting", async (t) => {
  const env = await fixture(t);
  await send(env, "UserPromptSubmit", { prompt: "small task" });
  await send(env, "PostToolUse", {
    tool_name: "exec",
    tool_input: "await tools.apply_patch('not executed by this event')",
  });
  await send(env, "PostToolUse", { tool_name: "apply_patch", tool_input: { command: "patch" } });
  await send(env, "PostToolUse", {
    tool_name: "Bash",
    tool_input: { command: "Set-Content -LiteralPath output.txt -Value done" },
  });
  await send(env, "PostToolUse", { tool_name: "update_plan", tool_input: { plan: [] } });
  await send(env, "PostToolUse", { tool_name: "Agent", tool_input: { task: "review" } });

  const state = await persisted(env);
  assert.equal(state.toolCount, 5);
  assert.equal(state.mutationCount, 2);
  assert.equal(state.delegated, true);
});

test("cleanup prunes only recognized immediate plugin state artifacts", async (t) => {
  const env = await fixture(t);
  const staleStateA = `${"a".repeat(64)}.json`;
  const staleStateB = `${"b".repeat(64)}.json`;
  const stateNamedDirectory = `${"c".repeat(64)}.json`;
  const orphanTemporary = ".01234567-89ab-cdef-0123-456789abcdef.tmp";
  const unknownTemporary = ".not-plugin-state.tmp";
  const nestedDirectory = join(env.PLUGIN_DATA, stateNamedDirectory);

  await writeFile(join(env.PLUGIN_DATA, staleStateA), "{}\n", "utf8");
  await writeFile(join(env.PLUGIN_DATA, staleStateB), "{}\n", "utf8");
  await writeFile(join(env.PLUGIN_DATA, orphanTemporary), "partial", "utf8");
  await writeFile(join(env.PLUGIN_DATA, unknownTemporary), "keep", "utf8");
  await writeFile(join(env.PLUGIN_DATA, "keep.txt"), "keep", "utf8");
  await mkdir(nestedDirectory);
  await writeFile(join(nestedDirectory, staleStateA), "nested", "utf8");

  await send(env, "UserPromptSubmit", { prompt: "$thoughts cleanup" });

  const entries = await readdir(env.PLUGIN_DATA, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const stateFiles = files.filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
  assert.equal(stateFiles.length, 1);
  assert.equal(files.includes(orphanTemporary), false);
  assert.equal(files.includes(unknownTemporary), true);
  assert.equal(files.includes("keep.txt"), true);
  assert.deepEqual(directories, [stateNamedDirectory]);
  assert.equal(await readFile(join(nestedDirectory, staleStateA), "utf8"), "nested");

  const current = JSON.parse(await readFile(join(env.PLUGIN_DATA, stateFiles[0]), "utf8"));
  assert.deepEqual(Object.keys(current).sort(), Object.keys(initialState()).sort());
  assert.equal(current.explicit, true);
});

test("non-cleanup thoughts commands leave accumulated plugin state untouched", async (t) => {
  const env = await fixture(t);
  const staleState = `${"d".repeat(64)}.json`;
  const orphanTemporary = ".fedcba98-7654-3210-fedc-ba9876543210.tmp";
  await writeFile(join(env.PLUGIN_DATA, staleState), "{}\n", "utf8");
  await writeFile(join(env.PLUGIN_DATA, orphanTemporary), "partial", "utf8");

  await send(env, "UserPromptSubmit", { prompt: "$thoughts append" });

  const files = await readdir(env.PLUGIN_DATA);
  assert.equal(files.includes(staleState), true);
  assert.equal(files.includes(orphanTemporary), true);
  assert.equal(files.filter((name) => /^[a-f0-9]{64}\.json$/.test(name)).length, 2);
});

test("Stop skips trivial turns, active stop chains and turns that touched thoughts", async (t) => {
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
