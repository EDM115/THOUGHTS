import { readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

const template =
  "# THOUGHTS — Things Heard, Observed, Unclear, Guessed, Hacked, Tracked or Suspected : A living document about non-trivial details\n\nThis scratchpad preserves non-obvious project knowledge that would prevent a bad decision or costly rediscovery in a fresh thread.  \nRecord concise conclusions, constraints, consequential decisions and their rationale, verified gotchas, and unresolved questions with enough context to resume safely. Distinguish evidence from hypotheses. Do not store hidden chain-of-thought, transcripts, secrets, or routine progress logs.  \nDevelopers own their entries. The main orchestrator may maintain agent-authored entries according to the selected thoughts command; subagents report candidates to the parent instead of editing this file. Preserve user-authored text unless changes are explicitly authorized.  \nInformation already authoritative in README, AGENTS, plans, issues, documentation, code, comments, tests, or existing thoughts should not be duplicated here.\n";

function fail(path, message) {
  errors.push(`${path}: ${message}`);
}

async function text(path) {
  try {
    return await readFile(join(root, path), "utf8");
  } catch {
    fail(path, "missing or unreadable");
    return null;
  }
}

async function json(path) {
  const contents = await text(path);
  if (contents === null) return null;
  try {
    return JSON.parse(contents);
  } catch {
    fail(path, "must contain valid JSON");
    return null;
  }
}

async function exists(path) {
  try {
    await stat(join(root, path));
    return true;
  } catch {
    fail(path, "missing");
    return false;
  }
}

const manifestPath = ".codex-plugin/plugin.json";
const manifest = await json(manifestPath);
if (manifest !== null) {
  if (manifest.name !== "thoughts") fail(manifestPath, "name must be thoughts");
  if (root.split(/[\\/]/).at(-1)?.toLowerCase() !== "thoughts")
    fail(manifestPath, "plugin folder must be named thoughts");
  if (
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
      manifest.version ?? "",
    )
  )
    fail(manifestPath, "version must be strict semver");
  if (manifest.skills !== "./skills/") fail(manifestPath, "skills must be ./skills/");
  if (Object.hasOwn(manifest, "hooks"))
    fail(manifestPath, "hooks must use default discovery, not a manifest field");
  if (manifest.skills === "./skills/") await exists("skills");
}

const hooks = await json("hooks/hooks.json");
const requiredEvents = [
  "UserPromptSubmit",
  "PostToolUse",
  "SubagentStart",
  "Stop",
  "PreCompact",
  "SessionStart",
];
if (hooks !== null) {
  for (const event of requiredEvents) {
    const groups = hooks.hooks?.[event];
    if (!Array.isArray(groups) || groups.length === 0) {
      fail("hooks/hooks.json", `missing ${event} command hook`);
      continue;
    }
    for (const group of groups) {
      for (const handler of group.hooks ?? []) {
        if (handler.type !== "command")
          fail("hooks/hooks.json", `${event} must use command handlers only`);
      }
    }
  }
  if (hooks.hooks?.SessionStart?.[0]?.matcher !== "compact")
    fail("hooks/hooks.json", "SessionStart must match compact only");
}

const skillPath = "skills/thoughts/SKILL.md";
const skill = await text(skillPath);
if (skill !== null) {
  const match = skill.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (match === null) {
    fail(skillPath, "missing YAML frontmatter");
  } else {
    const keys = match[1]
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Za-z0-9_-]+):/)?.[1])
      .filter(Boolean)
      .sort();

    if (JSON.stringify(keys) !== JSON.stringify(["description", "metadata", "name"])) {
      fail(skillPath, "frontmatter may contain only name, description and metadata");
    }
  }
}

const openaiYaml = await text("skills/thoughts/agents/openai.yaml");
if (openaiYaml !== null && !/default_prompt:\s*["'].*\$thoughts/i.test(openaiYaml))
  fail("skills/thoughts/agents/openai.yaml", "default_prompt must mention $thoughts");

const assetPath = "skills/thoughts/assets/THOUGHTS.md";
const asset = await text(assetPath);
if (asset !== null && asset !== template)
  fail(assetPath, "mandatory opening does not match the exact template bytes");

const readme = await text("README.md");
if (readme !== null) {
  const requiredSections = ["Installation", "Commands", "Privacy", "Limitations", "License"];
  for (const section of requiredSections) {
    if (!new RegExp(`^##\\s+${section}\\s*$`, "im").test(readme))
      fail("README.md", `missing ${section} section`);
  }
  for (const phrase of [
    "npx skills add EDM115/thoughts",
    "$thoughts cleanup",
    "PreCompact",
    "THOUGHTS.md",
  ]) {
    if (!readme.includes(phrase)) fail("README.md", `missing ${phrase}`);
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log(`Package validation passed: ${relative(process.cwd(), root) || "."}`);
}
