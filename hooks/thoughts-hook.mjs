import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const CONTINUATION_REASON =
  "Use $thoughts append now. Apply its write gate: preserve only durable, non-obvious context that would prevent a bad decision or costly rediscovery in a fresh thread. If nothing qualifies, do not edit THOUGHTS.md and immediately finish the original response.";
const COMPACTION_CONTEXT =
  "Use $thoughts append now because Codex just resumed after compaction. Apply its semantic write gate: preserve only durable, non-obvious context that would prevent a bad decision or costly rediscovery in a fresh thread. If the post-compaction request is a short unrelated prompt or no material work lacks a checkpoint, do not edit THOUGHTS.md and continue the original request.";
const SUBAGENT_CONTEXT =
  "You are a subagent and must never edit `THOUGHTS.md`. If this is substantial delegated work and you discover a durable non-obvious constraint, conclusion, gotcha or unresolved risk, add a concise `Thought candidates` section to your final report. The main orchestrator will independently vet it.";
const NO_THOUGHTS_MARKER = "[//]: # (<NO_THOUGHTS>)";
const STATE_FILE_PATTERN = /^[a-f0-9]{64}\.json$/;
const TEMPORARY_FILE_PATTERN = /^\.[0-9a-f-]+\.tmp$/;

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
    mutationCount:
      Number.isSafeInteger(value.mutationCount) && value.mutationCount >= 0
        ? value.mutationCount
        : 0,
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

async function cleanupPluginData(env) {
  if (!env?.PLUGIN_DATA) return;
  try {
    const entries = await readdir(env.PLUGIN_DATA, { withFileTypes: true });
    const removals = entries
      .filter(
        (entry) =>
          entry.isFile() &&
          (STATE_FILE_PATTERN.test(entry.name) || TEMPORARY_FILE_PATTERN.test(entry.name)),
      )
      .map((entry) => rm(join(env.PLUGIN_DATA, entry.name), { force: true }));
    await Promise.allSettled(removals);
  } catch {
    // Cleanup is maintenance only. Missing, unreadable or locked state must never block Codex.
  }
}

export function classifyPrompt(prompt) {
  const text = typeof prompt === "string" ? prompt : "";
  // State pruning has side effects: require a whole command, not a mention in prose or a code fence.
  const cleanup = /^(?:please\s+)?(?:(?:use|run)\s+)?\$?thoughts\s+cleanup[.!]?$/i.test(text.trim());
  const explicit =
    /\$thoughts\b/i.test(text) ||
    /\bthoughts\s+(?:append|init|cleanup)\b/i.test(text) ||
    /\b(?:preserve|save|write|append|update|clean(?:\s+up)?)\b[^\r\n]{0,80}\bTHOUGHTS\.md\b/i.test(
      text,
    );
  const largeScope =
    /\b(?:architectur(?:e|al)|migrat(?:e|ion)|refactor(?:ing)?|investigat(?:e|ion|ing)|rewrite|overhaul|moderniz(?:e|ation)|replatform|upgrade|cross[- ]cutting|end[- ]to[- ]end|system[- ]wide|codebase[- ]wide|repo[- ]wide|large[- ]scale|multi[- ](?:step|file|module|package|service|repo)|plan(?:ning|s|ned)?|implement(?:ation|ing|ed)?|integrat(?:e|ion)|debug(?:ging)?|diagnos(?:e|is|tic)|performance optimiz(?:e|ation|ing)|security (?:review|audit|scan|harden(?:ing)?)|delegat(?:e|ed|ion)|subagent|rollout|redesign|release|deploy(?:ment|ing)?|spec(?:ification)?|roadmap)\b/i.test(
      text,
    );
  return { explicit, largeScope, cleanup };
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
  return /\b(?:apply_patch|Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Move-Item|Copy-Item|mkdir|touch|rm|mv|cp)\b|(?:^|\s)(?:>>?|2>)(?:\s|$)/i.test(
    serializedInput,
  );
}

function isDelegation(toolName) {
  return /^(?:Agent|spawn_agent)$/i.test(toolName);
}

function writesThoughts(toolName, input) {
  const isThoughtsPath = (path) => typeof path === "string" && /(?:^|[\\/])THOUGHTS\.md$/i.test(path.trim());
  if (/^(?:Edit|Write)$/i.test(toolName)) {
    return isThoughtsPath(input?.file_path ?? input?.path);
  }
  if (toolName !== "apply_patch") return false;
  const patch = typeof input === "string" ? input : input?.patch ?? input?.command;
  if (typeof patch !== "string") return false;
  // Body text, reads, shell commands, and outer Code Mode source are not checkpoint evidence.
  return [...patch.matchAll(/^\*\*\* (?:Add|Update) File: (.+)\r?$/gm)].some((match) => isThoughtsPath(match[1]));
}

export function shouldContinue(event, state) {
  if (event?.stop_hook_active === true || state.thoughtsTouched) return false;
  if (
    typeof event?.last_assistant_message === "string" &&
    event.last_assistant_message.includes(NO_THOUGHTS_MARKER)
  ) {
    return false;
  }
  return (
    state.explicit ||
    state.mutationCount >= 4 ||
    state.toolCount >= 10 ||
    state.delegated ||
    state.compactionPending ||
    (state.largeScope && state.toolCount >= 5)
  );
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
      if (signals.cleanup) await cleanupPluginData(env);
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
      if (writesThoughts(toolName, event.tool_input)) state.thoughtsTouched = true;
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
