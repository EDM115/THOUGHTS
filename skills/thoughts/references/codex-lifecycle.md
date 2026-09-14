# Codex lifecycle integration
The portable skill owns the semantic write decision. The optional Node.js hook requests a check and stores normalized activity signals; it never reads or writes project thoughts. Implicit skill activation remains model-controlled.

## Signals and completion
A Stop check is requested for an explicit persistence signal, four mutations, ten tool events, delegation, pending compaction recovery, or large-scope language with at least five tool events. These are heuristics for a potentially useful checkpoint, not evidence that a note deserves to be written.
`PostToolUse` observes canonical tool events through a catch-all matcher, including supported nested Code Mode calls. The hook does not parse outer JavaScript to infer hidden operations. Mutation counts are approximate; unsupported tool paths may not be observable.
A supported `Write`/`Edit` file target or `apply_patch` Add/Update header naming `THOUGHTS.md` marks the turn as checkpointed. Reads, searches, mentions in patch bodies, deletions, and arbitrary shell commands do not. This detects a reported write target, not whether the content is useful or complete; the semantic gate remains the agent's responsibility. A completed pass through another tool can use the exact no-pending-checkpoint marker defined in [SKILL.md](../SKILL.md#finish-and-suppress-redundant-checks).
`stop_hook_active`, a recognized checkpoint, or that exact marker suppresses Stop continuation. The marker is case-sensitive and matched as a substring; it carries no project content and is not persisted. Keep its example identical to the implementation.

## Compaction and delegation
`PreCompact` records a pending boolean when no recognized checkpoint exists and allows compaction to continue. This implementation performs no model work before compaction. `SessionStart(source=compact)` injects one recovery reminder and clears the pending signal. A short unrelated continuation or already-documented work can still produce a no-op.
`SubagentStart` reminds a child to leave project thoughts edits to the parent. A child can report durable candidates from substantial work, but has no obligation to manufacture a section or perform extra research for it.

## State, cleanup, and limits
State under `PLUGIN_DATA` contains the turn ID, counters, and booleans only; filenames hash the session ID. Prompts, messages, tool payloads, source/transcript paths, and project contents are not persisted. Writes use a temporary sibling plus rename; unreadable or corrupt state fails open.
Whole-command cleanup prunes only immediate files matching the hook's hashed-state or temporary-file naming patterns. Unknown files and all directories are preserved. It can clear state from other sessions; it is maintenance, not a per-turn action. The exact accepted prompt grammar is in [maintenance.md](maintenance.md#optional-plugin-state-maintenance).
Repository tests exercise the handler and command entrypoint. Passing them does not prove a running Codex app has loaded a changed plugin or trusted its hooks; verify installation and a fresh-session lifecycle separately when deploying an update. Do not edit installed caches as part of source development.
