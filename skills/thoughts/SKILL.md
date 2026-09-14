---
name: thoughts
description: Use when the user asks to save, initialize, clean up, or resume project thoughts; a lifecycle hook requests a checkpoint check; or ongoing work with an existing THOUGHTS.md reveals durable, non-obvious context at risk of being lost across compaction or handoff.
metadata:
  author: EDM115
  version: 1.2.0
---

# Thoughts
Preserve project knowledge that would prevent a bad decision or costly rediscovery in a fresh thread. Store concise conclusions, constraints, evidence, and open questions, not hidden chain-of-thought, transcripts, or a work log.

## Select the operation
| Request | Operation |
| --- | --- |
| `$thoughts`, `$thoughts append`, or a checkpoint reminder | Apply the write gate; append only qualifying knowledge. A no-op is a complete result. |
| `$thoughts init` | Explicitly initialize a file, including an opening-only file when nothing qualifies. Read [maintenance.md](references/maintenance.md#init). |
| `$thoughts cleanup` | Verify and curate existing entries. Read [maintenance.md](references/maintenance.md#cleanup). |
| Resume or hand off from existing thoughts | Read relevant entries as leads, verify change-sensitive claims when needed for the task, then apply the gate to any new knowledge. |
Explicit invocation works when no file exists. Implicit selection is for an existing project scratchpad with relevant new knowledge; mentioning the skill while reviewing its implementation is not a request to maintain project notes. A hook requests consideration, not an unconditional write. Honor an explicit user opt-out.

## Apply the write gate
Would a capable agent starting a fresh thread make a worse decision or repeat costly work without this item?
- Keep a non-obvious constraint, consequential decision and rationale, validated gotcha, unresolved risk, or unfinished step whose safe resumption depends on missing context.
- Use the current conversation and available evidence. Distinguish verified facts from hypotheses and open questions; include a concise evidence pointer when it helps recheck the claim.
- Skip routine actions, completion/status narration, facts already authoritative in README, AGENTS, plans, issues, code, comments, tests, or existing thoughts, and speculation without a concrete future decision attached.
- High tool counts, delegation, compaction, or an explicit append request prompt this check; they do not themselves qualify as knowledge to save. Reuse context already available rather than scanning the repository to manufacture an entry.
For append, stop when no candidate qualifies or the existing file already covers it. Do not create a file, add a dated heading, or broaden the search merely to produce an update. `init` has the explicit opening-only behavior described above.

## Resolve one target
Use the canonical project path already established by the user or repository context. Otherwise inspect only the repository-root directory and established developer-documentation home for `THOUGHTS.md`; do not recursively search sources, dependencies, or skill templates.
- Reuse the sole existing project file in those locations.
- If multiple project candidates remain ambiguous, leave them unchanged and report the conflict. Pause only the thoughts edit; continue independent work on the user's original request.
- If absent and a write qualifies, use an established documentation home (`docs/`, `doc/`, `documentation/`, `developer-docs/`, or `dev-docs/`) known from the repository context, otherwise use the root. Do not create a documentation directory just for this file.
Read the resolved file to avoid duplicates. When creating it, copy [assets/THOUGHTS.md](assets/THOUGHTS.md) byte-for-byte as its opening. Existing project openings are not migrated during append or cleanup.

## Append and protect ownership
Only the main orchestrator edits project thoughts. Subagents may return concise `Thought candidates` from substantial work already performed; the parent applies the same gate. This skill does not require delegation or a candidate section when there is nothing useful.
Update the current conversation's section when model and harness match, including a direct continuation on another date; retain its original heading date. Otherwise create a section only for qualifying bullets:
```md
## YYYY-MM-DD — Model name + reasoning — Harness — "Conversation name"

- Fact or decision, with the reason it matters and an evidence pointer if useful.
```
Use exposed metadata: `Unknown model` when unavailable, omit an unknown reasoning suffix, and use the literal conversation title when available or a short descriptive label otherwise. Never invent an exact title or reasoning level. Each bullet should stand on its own without reconstructing the conversation.
Append may correct obsolete wording only in its own matching section when current evidence proves the correction. Preserve other agents' and user-authored sections. User entries use `## YYYY-MM-DD — User — "Thought recap"` (or an established developer name); attribute text to the user only when they supplied it or explicitly requested a user-authored entry. Maintenance permissions are in the reference.

## Finish and suppress redundant checks
After one gate/checkpoint pass, return to the original task. For an explicit maintenance request, report whether the file changed and the resolved path; for an implicit or hook-triggered no-op, finish without adding a routine status paragraph.
When no qualifying checkpoint remains, the main orchestrator may include the following exact case-sensitive marker in its final message. It is especially useful after a no-op or an edit made through a tool the hook cannot recognize. With a conversation-level opt-out, include it in every final response and make no thoughts edits.
```md
Visible final response.

[//]: # (<NO_THOUGHTS>)

```
Place the marker on its own line with an empty line before and after it, outside a code fence, so Markdown hides it. The hook checks the exact substring, not its Markdown placement. Never use it to conceal a qualifying checkpoint that remains undone. Subagents do not emit it for the parent. Standalone use requires no hook or marker; load [codex-lifecycle.md](references/codex-lifecycle.md) only when configuring or diagnosing the optional plugin.
