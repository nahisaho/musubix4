---
schemaVersion: 1
id: CHANGE-0019
summary: Clarify same-day stable release chronology
status: completed
---
# CHANGE-0019: same-day release chronology

Requirements: REQ-AUTONOMOUS-DEVELOPMENT-019

## Intent

Make the durable release-history rule unambiguous for multiple stable releases
on one calendar date without weakening semantic-version ordering or the
immutable v0.1.0 baseline.

## Classification

Behavioral specification clarification with deterministic regression coverage.

## Impact

- Keep stable headings ordered by descending semantic version.
- Require every post-baseline date to be later than the immutable v0.1.0 date.
- Require each prepended heading date to be no earlier than the next older
  heading below it, allowing adjacent same-day releases.
- Update the existing release-document test rather than introducing a separate
  date-ordering owner.

## Verification

- A fresh requirement-linked Red and Green test cycle for
  REQ-AUTONOMOUS-DEVELOPMENT-019. The append-only change-phase ordering
  relationship is separately bounded by `CHANGE_ORDER_MIGRATION_REQUIRED`,
  `CHANGE_RED_UNPROVEN`, `CHANGE_GREEN_UNPROVEN`, and
  `CHANGE_COMPLETENESS_TDD` waivers; those waivers do not waive the test
  outcomes or chronology assertions.
- Requirements, design, trace, full test, and release-version verification.
