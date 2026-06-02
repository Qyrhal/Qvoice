<!--
  FILE: CLAUDE.md
  PURPOSE: Claude Code primary memory. Loaded at every session start.
           Delegates to AGENTS.md for shared context; .claude/ for deep memory.
  Target: ≤ 80 lines.
-->

# Qvoice

> See AGENTS.md for full project context, commands, and conventions.

## Claude-specific notes
- The transcribe_server.py runs as a long-lived child process with a request loop
- Audio is written to /tmp and cleaned up in `finally` blocks
- macOS permissions: Accessibility (hotkey), Microphone (recording) — user must grant manually
- Settings.local.json exists in .claude/ — do not overwrite

## Memory index
@AGENTS.md
@.claude/memory/architecture.md
@.claude/memory/decisions.md
@.claude/rules/maintain.md
@.claude/rules/coding.md
