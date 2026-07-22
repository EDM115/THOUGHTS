import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const CONTINUATION_REASON = "Use $thoughts append now. Apply its write gate: preserve only durable, non-obvious context that would prevent a bad decision or costly rediscovery in a fresh thread. If nothing qualifies, do not edit THOUGHTS.md and immediately finish the original response.";
const COMPACTION_CONTEXT = "Use $thoughts append now because Codex just resumed after compaction. Apply its semantic write gate: preserve only durable, non-obvious context that would prevent a bad decision or costly rediscovery in a fresh thread. If the post-compaction request is a short unrelated prompt, or no material work lacks a checkpoint, do not edit THOUGHTS.md and continue the original request.";
const SUBAGENT_CONTEXT = "You are a subagent and must never edit `THOUGHTS.md`. If this is substantial delegated work and you discover a durable non-obvious constraint, conclusion, gotcha, or unresolved risk, add a concise `Thought candidates` section to your final report. The main orchestrator will independently vet it.";

const STATE_KEYS = [
  "turnId",
  "explicit",
  "largeScope",
  "toolCount",
  "mutationCount",
  "delegated",
  "thoughtsTouched",
  "compactionPending",
];

export function initialState() {
  return {
    turnId: "",
    explicit: false,
    largeScope: false,
    toolCount: 0,
    mutationCount: 0,
    delegated: false,
    thoughtsTouched: false,
    compactionPending: false,
  };
}

function normalizeState(value) {
  const defaults = initialState();
  if (value === null || typeof value !== "object" || Array.isArray(value)) return defaults;
  return {
    turnId: typeof value.turnId === "string" ? value.turnId : defaults.turnId,
    explicit: value.explicit === true,
    largeScope: value.largeScope === true,
    toolCount: Number.isSafeInteger(value.toolCount) && value.toolCount >= 0 ? value.toolCount : 0,
    mutationCount: Number.isSafeInteger(value.mutationCount) && value.mutationCount >= 0 ? value.mutationCount : 0,
    delegated: value.delegated === true,
    thoughtsTouched: value.thoughtsTouched === true,
    compactionPending: value.compactionPending === true,
  };
}

function statePath(env, sessionId) {
  if (!env?.PLUGIN_DATA || typeof sessionId !== "string" || sessionId.length === 0) return null;
  const digest = createHash("sha256").update(sessionId).digest("hex");
  return join(env.PLUGIN_DATA, `${digest}.json`);
}

export async function readState(env, sessionId) {
  const path = statePath(env, sessionId);
  if (path === null) return initialState();
  try {
    return normalizeState(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return initialState();
  }
}

export async function writeState(env, sessionId, state) {
  const path = statePath(env, sessionId);
  if (path === null) return false;
  const safeState = normalizeState(state);
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temporary, `${JSON.stringify(safeState)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
    return true;
  } catch {
    return false;
  }
}

export function classifyPrompt(prompt) {
  const text = typeof prompt === "string" ? prompt : "";
  const explicit = /\$thoughts\b/i.test(text)
    || /\bthoughts\s+(?:append|init|cleanup)\b/i.test(text)
    || /\b(?:preserve|save|write|append|update|clean(?:\s+up)?)\b[^\r\n]{0,80}\bTHOUGHTS\.md\b/i.test(text);
  const largeScope = /\b(?:architecture|architectural|migration|migrate|refactor|investigat(?:e|ion)|multi[- ]step|plan(?:ning|s|ned)?|implement(?:ation|ing)?|security (?:review|audit|scan)|delegate|delegated|subagent|rollout|redesign)\b/i.test(text);
  return { explicit, largeScope };
}

function stringifyInput(input) {
  try {
    return JSON.stringify(input ?? {});
  } catch {
    return "";
  }
}

function isMutation(toolName, serializedInput) {
  if (/^(?:apply_patch|Edit|Write)$/i.test(toolName)) return true;
  if (!/^(?:Bash|shell_command|exec_command)$/i.test(toolName)) return false;
  return /\b(?:apply_patch|Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Move-Item|Copy-Item|mkdir|touch|rm|mv|cp)\b|(?:^|\s)(?:>>?|2>)(?:\s|$)/i.test(serializedInput);
}

function isDelegation(toolName) {
  return /^(?:Agent|spawn_agent)$/i.test(toolName);
}

function touchesThoughts(serializedInput) {
  return /(?:^|[\\/])THOUGHTS\.md\b/i.test(serializedInput) || /"THOUGHTS\.md\b/i.test(serializedInput);
}

export function shouldContinue(event, state) {
  if (event?.stop_hook_active === true || state.thoughtsTouched) return false;
  return state.explicit
    || state.mutationCount >= 2
    || state.toolCount >= 8
    || state.delegated
    || state.compactionPending
    || (state.largeScope && state.toolCount >= 1);
}

function contextOutput(hookEventName, additionalContext) {
  return { hookSpecificOutput: { hookEventName, additionalContext } };
}

export async function handleEvent(event, env = process.env) {
  if (event === null || typeof event !== "object" || Array.isArray(event)) return {};
  const eventName = event.hook_event_name;
  const sessionId = event.session_id;

  if (eventName === "SubagentStart") {
    const state = await readState(env, sessionId);
    state.delegated = true;
    await writeState(env, sessionId, state);
    return contextOutput("SubagentStart", SUBAGENT_CONTEXT);
  }

  if (typeof sessionId !== "string" || sessionId.length === 0 || !env?.PLUGIN_DATA) return {};

  try {
    const state = await readState(env, sessionId);

    if (eventName === "UserPromptSubmit") {
      const signals = classifyPrompt(event.prompt);
      const next = {
        ...initialState(),
        turnId: typeof event.turn_id === "string" ? event.turn_id : "",
        explicit: signals.explicit,
        largeScope: signals.largeScope,
        compactionPending: state.compactionPending,
      };
      await writeState(env, sessionId, next);
      return {};
    }

    if (eventName === "PostToolUse") {
      const toolName = typeof event.tool_name === "string" ? event.tool_name : "";
      const serializedInput = stringifyInput(event.tool_input);
      state.toolCount += 1;
      if (isMutation(toolName, serializedInput)) state.mutationCount += 1;
      if (isDelegation(toolName)) state.delegated = true;
      if (touchesThoughts(serializedInput)) state.thoughtsTouched = true;
      await writeState(env, sessionId, state);
      return {};
    }

    if (eventName === "Stop") {
      return shouldContinue(event, state) ? { decision: "block", reason: CONTINUATION_REASON } : {};
    }

    if (eventName === "PreCompact") {
      state.compactionPending = !state.thoughtsTouched;
      await writeState(env, sessionId, state);
      return {};
    }

    if (eventName === "SessionStart" && event.source === "compact" && state.compactionPending) {
      state.compactionPending = false;
      await writeState(env, sessionId, state);
      return contextOutput("SessionStart", COMPACTION_CONTEXT);
    }

    return {};
  } catch {
    return {};
  }
}

export async function main() {
  try {
    let input = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) input += chunk;
    const event = JSON.parse(input);
    process.stdout.write(`${JSON.stringify(await handleEvent(event, process.env))}\n`);
  } catch {
    process.stdout.write("{}\n");
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invokedPath === import.meta.url) await main();

export { STATE_KEYS };
