---
schemaVersion: 1
id: CHANGE-0001
summary: Build MUSUBIX4 as a MUSUBIX3-compatible autonomous development CLI using Harness-of-Harness
status: in-progress
---
# CHANGE-0001: autonomous-development-runtime

Requirements: REQ-AUTONOMOUS-DEVELOPMENT-001 REQ-AUTONOMOUS-DEVELOPMENT-002 REQ-AUTONOMOUS-DEVELOPMENT-003 REQ-AUTONOMOUS-DEVELOPMENT-004 REQ-AUTONOMOUS-DEVELOPMENT-005 REQ-AUTONOMOUS-DEVELOPMENT-006 REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-008 REQ-AUTONOMOUS-DEVELOPMENT-009 REQ-AUTONOMOUS-DEVELOPMENT-010 REQ-AUTONOMOUS-DEVELOPMENT-011 REQ-AUTONOMOUS-DEVELOPMENT-012 REQ-AUTONOMOUS-DEVELOPMENT-013 REQ-AUTONOMOUS-DEVELOPMENT-014 REQ-AUTONOMOUS-DEVELOPMENT-015 REQ-AUTONOMOUS-DEVELOPMENT-016 REQ-AUTONOMOUS-DEVELOPMENT-017 REQ-AUTONOMOUS-DEVELOPMENT-018

## Intent

Create MUSUBIX4 as a fresh-history successor CLI based on the latest default
branch of `nahisaho/musubix3`, preserving its CLI commands and `.musubix`
artifacts while adding a resumable Harness-of-Harness runtime for GitHub
Copilot CLI.

The runtime shall repeatedly invoke independent Planner, Developer, and QA
roles around one evolving application. It shall preserve verified behavior,
advance in bounded increments, isolate QA in Git worktree snapshots, retain
structured cross-iteration evidence, enforce role-specific least privilege,
support controlled rollback, and stop deterministically on readiness, limits,
stagnation, cancellation, or unrecoverable failure.

The full v1 scope includes natural-language, Markdown, GitHub Issue, and
existing `.musubix` specification inputs; generic configured commands plus
Node.js/TypeScript command discovery; all seven selected QA dimensions;
artifact-bound approvals with the safe MUSUBIX3 default; internal Git refs for
version history; and an approved configured-command deployment adapter with
verification and rollback.

## Confirmed decisions

- MUSUBIX3 baseline: default branch commit
  `c0b20f06727bceb04eeec181d95af9047b1981de`.
- Product: one successor CLI, package and command name `musubix4`.
- Harness: GitHub Copilot CLI only in v1.
- Runtime: foreground, resumable `run`/`resume`/`status`/`stop` commands.
- Default approval policy: requirements, design, and release approvals remain
  required and are configurable.
- Default run limit: 30 iterations, 24 hours, required AI-credit budget, and
  stagnation after three consecutive non-improving iterations.
- QA isolation: Git commit plus read-only temporary worktree snapshot.
- Compatibility: existing MUSUBIX3 CLI and `.musubix` artifacts remain usable.
- History: MUSUBIX3 source is copied without importing its Git history.
- Model: one user-selected model is fixed for every role in a run.
- Permissions: role-specific least privilege with explicit configuration.
- Completion: configured deploy, verify, and rollback commands may run only
  after readiness and release approval.

