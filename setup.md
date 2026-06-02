# setup.md

<!--
  PURPOSE: Agent-executable runbook for bootstrapping agent configuration files.
  Supports Claude Code (.claude/), universal AGENTS.md, or both.
  Scope: only the files listed below. Never touches source code or CI config.
  Refs:
    https://code.claude.com/docs/en/claude-directory
    https://agents.md/
    https://github.com/agentsmd/agents.md
-->

---

## Scope

Depending on mode selected in Phase 2, touches only:

```
AGENTS.md               ← universal format (agents.md spec), project root
CLAUDE.md               ← Claude Code primary memory, project root
.claude/
  settings.json
  settings.local.json   ← gitignored, personal overrides
  CLAUDE.local.md       ← gitignored, personal notes
  commands/             ← slash-command stubs
  rules/
    maintain.md         ← self-maintenance contract, every session
    coding.md           ← behavioural guardrails, every session
  memory/
    architecture.md
    decisions.md
  kanban.md             ← live issue tracker
  improvements.md       ← forward-looking backlog
```

**Never touches source code, CI config, dependencies, or lockfiles.**

---

## Phase 1 — Scan

Read silently. Do not output findings yet.

| Check | What to look for |
|---|---|
| Language / runtime | `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `*.csproj` |
| Test runner | test scripts, pytest config, Makefile targets |
| Build commands | build scripts, Makefile, Dockerfile |
| Lint / format | `.eslintrc`, `.prettierrc`, `ruff.toml`, `.golangci.yml` |
| Secrets exposure | `.env` committed, hardcoded tokens, API keys in source |
| Dependency hygiene | lockfile present, `node_modules` committed, CVE patterns |
| Structure clarity | deep nesting, missing README, no obvious entrypoint |
| Permissions / auth | middleware patterns, auth guards, RBAC hints |
| Logging | structured vs. ad-hoc, sensitive data in logs |
| Error handling | bare `catch {}`, unhandled promise rejections, unrecovered panics |
| Existing agent files | `AGENTS.md`, `CLAUDE.md`, `.claude/`, `.cursor/`, `.aider.conf.yml` |

---

## Phase 2 — Questions

Batch all questions into one prompt. Skip any answered by the scan.

```
I've scanned the repo. A few things I need to confirm:

0. Which agent configuration do you want?
   a) AGENTS.md only       — works across all agents (OpenAI Codex, Cursor,
                              Windsurf, Gemini CLI, Aider, GitHub Copilot, etc.)
   b) .claude/ only        — Claude Code-specific, full feature set
   c) Both                 — AGENTS.md as universal base + .claude/ as
                              Claude-specific enhancement layer [recommended]

1. [If runtime ambiguous] What language/runtime is primary?
2. [If no test runner found] What command runs tests?
3. [If no build script found] What is the build command?
4. What is the primary purpose of this project? (one sentence)
5. Any security or compliance requirements? (HIPAA, PCI-DSS, GDPR, SOC 2, etc.)
6. Any team conventions not obvious from code? (style, PR rules, etc.)
7. [If mode includes .claude/] Create settings.local.json for personal overrides? (yes/no)
8. [If existing agent files found] Existing files detected: <list>. Merge or replace?
```

Proceed based on answer to Q0. Sections below are labelled by mode.

---

## Phase 3 — Generate Files

### [ALL MODES] AGENTS.md (project root)

Universal format. Readable by any agent that supports the agents.md spec.
If mode is `.claude/ only`, skip this file.
If an AGENTS.md already exists and user chose merge, extend it rather than overwrite.

```markdown
<!--
  FILE: AGENTS.md
  PURPOSE: Universal agent instructions for this project.
           Works across Claude Code, OpenAI Codex, Cursor, Windsurf,
           Gemini CLI, Aider, GitHub Copilot, Amp, and others.
           Ref: https://agents.md/
  MAINTENANCE: Update commands, structure, and conventions when the project changes.
               For nested packages, place a child AGENTS.md inside each subdirectory.
-->

# <project-name>

## Overview
<one-sentence description>

## Stack
<language, framework, runtime — inferred from scan>

## Commands
```bash
build: <command>
test:  <command>
lint:  <command>
run:   <command>
```

## Structure
<3–6 line directory map — key folders only>

## Code style
- <style rule 1 — inferred or from Q6>
- <naming convention>
- <any compliance requirement from Q5>

## Testing
- Run the full test suite before any commit.
- Write or update tests for every change, even if not asked.
- A task is not done until tests pass.

## Security
- <inferred from scan or Q5 — e.g. "never log auth tokens", "validate all inputs">

## Conventions
- <PR or commit message format from Q6, if any>
- Clarify ambiguities before implementing.
- Prefer the simplest solution that works.
- Touch only what the task requires.
```

---

### [ALL MODES] Kanban and improvements

These live in `.claude/` when `.claude/` is enabled.
When `AGENTS.md only` mode is selected, place them at project root instead:

```
kanban.md
improvements.md
```

The files are identical in either case — only their location differs.

#### kanban.md

```markdown
<!--
  FILE: kanban.md  (or .claude/kanban.md)
  PURPOSE: Session-persistent issue tracker. At session start, agent reads
           this file, surfaces open items, and asks: fix / defer / dismiss?
           Agent updates status after each action.
  Quality bar: DO-178B-aligned — every fix traceable to symptom, root cause,
               and verification step.
  DO NOT auto-fix [RISK: HIGH] items without explicit user confirmation.
-->

## Backlog

| ID | Category | Severity | Item | Status |
|---|---|---|---|---|
<!-- Agent populates from Phase 1 scan findings -->
<!-- Severity: LOW / MED / HIGH / CRITICAL -->
<!-- Status: OPEN / IN-PROGRESS / FIXED / DEFERRED / DISMISSED -->

## Fix record

<!--
  Append for every resolved item — never edit or delete past records.

  ### FIX-<ID>
  **File:** <path>
  **Symptom:** <what was wrong>
  **Root cause:** <why it existed>
  **Change:** <what was done>
  **Verification:** <test command or manual step>
  **Date:** <ISO 8601>
-->
```

#### improvements.md

```markdown
<!--
  FILE: improvements.md  (or .claude/improvements.md)
  PURPOSE: Forward-looking backlog — maintainability, performance, security,
           and new features. Reviewed periodically, not every session.
-->

## Improvements

| ID | Priority | Effort | Category | Description | Acceptance criterion |
|---|---|---|---|---|---|
<!-- Category: maintainability | performance | security | feature -->
<!-- Priority: P1=do soon  P2=next quarter  P3=someday -->
<!-- Effort: S / M / L -->
```

---

### [.claude/ MODE] CLAUDE.md (project root)

Claude Code's primary memory file. Kept ≤ 80 lines; overflow goes to `.claude/memory/`.
If AGENTS.md was also generated, CLAUDE.md can be shorter — reference AGENTS.md rather than duplicating.

```markdown
<!--
  FILE: CLAUDE.md
  PURPOSE: Claude Code primary memory. Loaded at every session start.
           Delegates to AGENTS.md for shared context; .claude/ for deep memory.
  Target: ≤ 80 lines.
-->

# <project-name>

> See AGENTS.md for full project context, commands, and conventions.

## Claude-specific notes
<anything in AGENTS.md that needs Claude-specific framing or override>

## Memory index
@AGENTS.md
@.claude/memory/architecture.md
@.claude/memory/decisions.md
@.claude/rules/maintain.md
@.claude/rules/coding.md
```

If no AGENTS.md was generated, CLAUDE.md must be self-contained (include project,
commands, structure, standards sections — same content as AGENTS.md template above).

---

### [.claude/ MODE] .claude/settings.json

```json
{
  "permissions": {
    "allow": [
      "Bash(git:*)",
      "Bash(<build-command>)",
      "Bash(<test-command>)",
      "Bash(<lint-command>)"
    ],
    "deny": [
      "Bash(rm -rf *)",
      "Bash(curl * | bash)",
      "Bash(wget * | sh)"
    ]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "echo \"[AUDIT] $(date -u +%Y-%m-%dT%H:%M:%SZ) BASH: $CLAUDE_TOOL_INPUT\" >> .claude/audit.log"
          }
        ]
      }
    ]
  },
  "env": {
    "NODE_ENV": "development"
  }
}
```

Populate allow list with only commands actually found in the scan.
Audit log satisfies DO-178B traceability.

---

### [.claude/ MODE] .claude/settings.local.json (gitignored, if Q7 = yes)

```json
{
  "env": {
    "LOCAL_OVERRIDE": "true"
  }
}
```

---

### [.claude/ MODE] .claude/CLAUDE.local.md (gitignored)

```markdown
<!--
  FILE: CLAUDE.local.md
  PURPOSE: Personal session notes. Gitignored. Overrides CLAUDE.md locally.
-->

## My overrides
```

---

### [.claude/ MODE] .claude/memory/architecture.md

```markdown
<!--
  FILE: .claude/memory/architecture.md
  PURPOSE: Structural map of the codebase. Updated on significant refactors.
-->

## Architecture
<service boundaries, data flow, key modules — inferred from scan>
```

---

### [.claude/ MODE] .claude/memory/decisions.md

```markdown
<!--
  FILE: .claude/memory/decisions.md
  PURPOSE: Log of non-obvious design decisions. Prevents re-litigating choices.
-->

## Decision log
| Decision | Reason | Date |
|---|---|---|
| | | |
```

---

### [.claude/ MODE] .claude/rules/maintain.md

Loaded every session. Self-maintenance contract for the entire `.claude/` directory
and AGENTS.md (if present).

```markdown
<!--
  FILE: .claude/rules/maintain.md
  PURPOSE: Instructs the agent to maintain all agent config files throughout
           every session. Loaded automatically from rules/ on session start.
  DO NOT DELETE — removing this breaks session continuity.
-->

# Maintenance Rules

## Session start (always, before any task)

1. Read kanban.md. If OPEN or IN-PROGRESS items exist, present them:
   ```
   Open issues:
   - [ID] [SEVERITY] <description>
   Fix now / defer / dismiss?
   ```
2. Fix confirmed items highest-severity first. Append Fix record. Update status.
3. If no kanban items, check improvements.md — ask if user wants to action P1 items.

## During work (continuous)

**kanban.md**
- Add OPEN item immediately when you find a bug, security gap, or quality issue.
- Update to IN-PROGRESS when starting a fix.
- Update to FIXED and append Fix record when done.
- Update to DEFERRED or DISMISSED on user instruction.
- Never delete rows — only change status.

**improvements.md**
- Add a row for meaningful out-of-scope improvements found during work.
- Remove a row only when fully implemented and verified.

**AGENTS.md** (if present)
- Update commands, stack, structure, or conventions when the project changes.
- Keep it accurate — it is read by every agent, not just Claude.

**memory/architecture.md**
- Update when files, services, or data flows are added, removed, or renamed.

**memory/decisions.md**
- Append a row for every non-obvious design decision made this session.

**CLAUDE.md**
- Update if project context changes. Keep ≤ 80 lines.

**settings.json**
- Add to allow list when a new project command is introduced.
- Add to deny list when a shell-injection risk is found (log to kanban first).

## Session end (always, after last task)

1. All in-progress kanban items must be FIXED or DEFERRED.
2. Decisions made this session are logged in decisions.md.
3. architecture.md reflects current state.
4. AGENTS.md reflects any changed commands or conventions.
5. Write files silently. Do not summarise unless asked.

## Hard rules

- Never auto-fix [RISK: HIGH] kanban items without user confirmation.
- kanban Fix records are append-only. Never edit or delete past records.
- audit.log is append-only. Never truncate.
- CLAUDE.md must stay ≤ 80 lines.
- AGENTS.md is the source of truth for cross-agent conventions; CLAUDE.md defers to it.
```

---

### [.claude/ MODE] .claude/rules/coding.md

```markdown
<!--
  FILE: .claude/rules/coding.md
  PURPOSE: Behavioural guardrails for every coding task.
           Biases toward caution over speed — use judgment on trivial tasks.
           Loaded automatically from rules/ each session.
  DO NOT DELETE — removing this degrades output quality and traceability.
-->

# Coding Behaviour

## 1. Think Before Coding
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First
Minimum code that solves the problem. Nothing speculative.
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Heuristic: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes
Touch only what you must. Clean up only your own mess.

When editing existing code:
- Don't improve adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

Test: every changed line must trace directly to the user's request.

## 4. Goal-Driven Execution
Transform tasks into verifiable goals before starting:
- "Add validation" → "Write tests for invalid inputs, then make them pass."
- "Fix the bug" → "Write a test that reproduces it, then make it pass."
- "Refactor X" → "Ensure tests pass before and after."

For multi-step tasks, state a plan first:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
```

Weak criteria ("make it work") require constant clarification.
Strong criteria let you loop independently.

## Health check
These rules are working if:
- Diffs contain fewer unnecessary changes.
- Fewer rewrites from overcomplication.
- Clarifying questions come before implementation, not after mistakes.
```

---

## Phase 4 — Per-Session Routine

The agent follows `.claude/rules/maintain.md` automatically each session.
For `AGENTS.md only` mode, embed the session-start routine directly in AGENTS.md
under a `## Agent session routine` section using the same text.

The only manual step: user responds to the opening kanban prompt.

---

## Phase 5 — Documentation Standard

Every function or method added or modified must include a docblock:

```
Purpose  — what it does, one sentence
Params   — name, type, constraints
Returns  — type and meaning
Raises   — error types and when
Issues   — open kanban IDs affecting this function
Fixed    — closed kanban IDs (summary, date)
```

Every file the agent creates or substantively edits gets a header:

```
Purpose  — why this file exists
Owner    — module or domain
Deps     — direct dependencies
Issues   — open kanban IDs
```

Factual only. No filler. One sentence per field unless unavoidable.

---

## Constraints

- Scope: only files listed in the Scope section above.
- Never commit `settings.local.json` or `CLAUDE.local.md`.
- Never auto-fix `[RISK: HIGH]` kanban items without confirmation.
- CLAUDE.md ≤ 80 lines. Overflow to `.claude/memory/`.
- `audit.log` is append-only. Never truncate or delete.
- AGENTS.md is the cross-agent source of truth. Keep it agent-agnostic — no Claude-specific syntax inside it.
- If AGENTS.md and CLAUDE.md conflict, CLAUDE.md governs for Claude sessions only.
