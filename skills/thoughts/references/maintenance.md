# Initialize or clean up project thoughts
Use only for the selected maintenance command. The write gate, canonical target, and ownership rules in [SKILL.md](../SKILL.md) apply throughout. Source reads below are permitted for maintenance; they are not required for ordinary append.

## init
Resolve the canonical file. Read repository guidance and the documentation needed to locate durable gaps. Follow concrete leads into configuration, source, tests, or read-only Git history only when necessary to verify a candidate; initialization is not a mandatory whole-repository audit.
Create an absent file with the exact opening from [assets/THOUGHTS.md](../assets/THOUGHTS.md). An explicit init request authorizes this opening-only file even if no fact passes the gate. If the file already exists, preserve its opening and existing content, and add only verified non-duplicates under the current agent's section.
Stop when the relevant candidates are verified or no useful gap remains. Do not copy architecture inventories or authoritative documentation into thoughts. Report the path and whether entries were added, the file was only initialized, or nothing changed.

## cleanup
Read the existing file and verify the evidence needed for each proposed change. Follow entry references first; expand the investigation only when a claim cannot be resolved from its authoritative source. No existing file means a no-op, not initialization.
- Remove or mark obsolete agent-authored claims only when current evidence establishes their status. Uncertainty alone is not proof that an entry is stale; preserve the uncertainty or mark it unverified.
- Merge genuine duplicates and compress verbose entries without combining unrelated constraints or erasing rationale needed for safe resumption.
- Preserve still-valid entries from other agents and the existing opening exactly. A newer bundled template does not authorize replacing a project's opening.
- Preserve user-authored text. Add a short verified `Implemented` or `Superseded` status note when justified. Report proposed substantial user-content rewrites separately; apply them only when explicitly authorized.
After reviewing the existing entries and verifying the proposed edits, stop. Cleanup need not discover new facts or audit unrelated code. Report applied changes and any protected user-content recommendations left unapplied.

## Optional plugin-state maintenance
The Codex hook prunes its recognized `PLUGIN_DATA` files only when the entire submitted prompt is a cleanup command: `$thoughts cleanup` or `thoughts cleanup`, optionally preceded by `please` and/or `use` or `run`, with optional final `.` or `!`. For example, `Please use $thoughts cleanup.` qualifies; a quoted example, explanatory question, negation, or a cleanup mention inside a larger task does not.
Free-form requests may still authorize the model to clean project notes; they simply do not trigger automatic hook-state deletion. Do not search for or delete harness data yourself. Standalone skill cleanup changes only the canonical project file. Hook cleanup preserves unknown files and directories and recreates current-session signal state; see [codex-lifecycle.md](codex-lifecycle.md) for the implementation boundary.
