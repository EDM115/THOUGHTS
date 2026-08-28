---
name: thoughts
description: (Auto-load only if a THOUGHTS.md file exists) Must be used by the main orchestrator to check for durable, non-obvious project knowledge before the final answer on high-value turns, after substantial implementations or delegation, near or after compaction and whenever the user explicitly asks to preserve, append, initialize, clean up, recap, hand off, or resume project thoughts. Use $thoughts, $thoughts append, $thoughts init or $thoughts cleanup. Never turn THOUGHTS.md into a per-turn log and never let ordinary exploration or review subagents edit it.
metadata:
  author: EDM115
  version: 1.2.0
---

# Thoughts

Preserve only working knowledge that would prevent a bad decision or costly rediscovery in a fresh thread. Do not record hidden chain-of-thought, transcripts, routine actions or information already authoritative elsewhere.  
Only the main orchestrator may edit `THOUGHTS.md`. If you are a subagent, do not edit it. For substantial delegated work, optionally return a concise `Thought candidates` section to the parent.

## Resolve the file

Resolve one canonical target per invocation and keep using it :

1. If exactly one `THOUGHTS.md` exists at the repository root or in the established developer-documentation home, use it.
2. If multiple candidates exist, stop and report the conflict. Never merge or choose silently.
3. Otherwise, use the established developer-documentation home when repository guidance or existing structure clearly identifies one. Conventional names include `docs/`, `doc/`, `documentation/`, `developer-docs/` and `dev-docs/`.
4. If no such home exists, use the repository root. Do not create a documentation directory solely for `THOUGHTS.md`.

For ordinary `append`, do not inspect source files to resolve the path. Use directory names and repository context already available. `init` and `cleanup` may inspect repository guidance and documentation.  
When creating the file, copy `assets/THOUGHTS.md` byte-for-byte as its opening.

## Apply the write gate

Write only durable, non-obvious information. Ask :

> Would a capable agent starting a fresh thread make a worse decision or repeat costly work without this item ?

An item can qualify when it captures :

- an explicit save, remember, recap, handoff or resumption request
- a non-obvious implementation, debugging, integration, security, migration, performance or architecture discovery
- a consequential decision or validated tradeoff
- a durable constraint, conclusion, gotcha or unresolved risk from substantial delegated work
- material unfinished work whose safe resumption would otherwise require rediscovery
- a needed checkpoint near or after compaction, a thread change or a long high-value turn

Skip the write when the turn was only a simple answer, lookup, rewrite, formatting change or mechanical action; no new durable fact or risk appeared; the prompt immediately after compaction is short and unrelated; the information is already authoritative in README, AGENTS, plans, issues, code, comments, tests or existing thoughts; or the candidate merely narrates what happened.  
Explicit invocation forces this check, not a file mutation. If nothing qualifies, leave the file unchanged.

## Control the Codex Stop hook

When the semantic write gate finds no necessary edit, the main orchestrator may append the exact `[//]: # (<NO_THOUGHTS>)` marker to its final assistant message so the Codex plugin does not request another thoughts pass.  
When the user asks not to save thoughts for the conversation, do not edit `THOUGHTS.md` and include the marker in every final assistant message for that conversation.

The marker is only for the hook and must stay invisible to the user. Put it on its own line after the user-visible response, with an empty line immediately before and after it. The raw final message must end like this, without a code fence :

```md
Visible final response.

[//]: # "<NO_THOUGHTS>"

```

The hook recognizes the exact case-sensitive marker but does not validate its Markdown placement, the marker can be placed anywhere in the final message provided it's separated by new lines. Correct empty-line formatting is the main agent's responsibility.  
The marker is a control token, not a thought entry. Never emit it while durable qualifying knowledge still needs checkpointing. Subagents do not control the main thread's `Stop` hook and must not emit it on the main orchestrator's behalf.

## Commands

Treat a bare `$thoughts` invocation as `$thoughts append`.

### append (default)

1. Resolve the target without scanning source.
2. Read only the resolved `THOUGHTS.md`. If it is absent, read only `assets/THOUGHTS.md` and create the target from that opening when at least one item qualifies.
3. Apply the write gate using current context and memory. Do not read any other repository file.
4. If nothing qualifies, make no edit and continue the original response.
5. Update the matching section for the same date, model, harness and conversation when one exists. Otherwise add a section only with at least one qualifying bullet.
6. Correct or remove obsolete wording only in the current agent's own section and only when current context directly proves the correction.

Never edit another agent's or a user's section during append.

### init

Survey repository guidance, documentation, architecture, configuration, source hotspots, tests and recent read-only Git history. Create the canonical file with the mandatory opening when absent.  
Record only verified, non-obvious facts useful to later implementation and not already documented authoritatively. Include concise evidence paths or identifiers when they help future verification, but do not turn the file into a source inventory or copy README, AGENTS, plans, comments or code.  
If no facts pass the gate, create only the mandatory opening and report that no durable entries were added.

### cleanup

Scan the repository and verify every proposed change against current evidence. Preserve the mandatory opening exactly.

- Remove or mark obsolete agent-authored facts
- Merge genuine duplicates and compress verbose or low-information phrasing without combining unrelated facts
- Preserve still-valid entries written by other agents
- Do not automatically remove, heavily rewrite or materially simplify user-authored entries
- A clearly verified user item may receive a short status note such as `Implemented` or `Superseded`, while preserving its original text
- Report changes applied and separately report proposed substantial changes to user-authored content

When this command runs with the Codex plugin, the hook automatically prunes recognized per-session state files and orphan temporary files from `PLUGIN_DATA`. Do not inspect, search for or delete harness data yourself. Standalone skill cleanup changes only the canonical `THOUGHTS.md`.

## Format entries

Agent entry :

```md
## YYYY-MM-DD — Model name + reasoning — Harness — "Conversation name"

- Concise durable fact with enough rationale to help in a fresh thread.
```

Use the exact model and reasoning level exposed by the harness. Never invent metadata, use `Unknown model` or omit only an unavailable reasoning suffix. Use the literal conversation title when available. Otherwise infer a short descriptive title without presenting it as a project summary.  
Continue the same entry across dates when it is the same conversation or a direct continuation with the same model and harness. Start a new entry when the conversation changes, the model or harness changes or the date changes and the work is neither the same conversation nor its continuation.
User-authored entry :

```md
## YYYY-MM-DD — User — "Thought recap"
```

May use the developer's known name instead of `User` when authorship is established in a multi-developer project. Only set by either the user itself or when the developer tells the agent to save a thought entry.

## Protect ownership

- Main orchestrator : may edit according to the selected command
- Exploration, research and review subagents : never edit `THOUGHTS.md`
- Subagents owning substantial delegated work : never edit the file, but may report `Thought candidates`
- Parent orchestrator : independently vets every candidate through the write gate
- User-authored content : protected from ordinary edits and from automatic substantial cleanup

## Finish

Keep every bullet concise but actionable. Prefer a fact plus the reason it matters over a vague reminder. Never claim to preserve hidden chain-of-thought.  
After the check, finish the user's original request. Report whether the file changed and its resolved path, for `cleanup`, also report protected user-content recommendations that were not applied.
