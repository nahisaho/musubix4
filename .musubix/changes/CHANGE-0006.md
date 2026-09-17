---
schemaVersion: 1
id: CHANGE-0006
summary: Automatically route top-level coding requests through Harness on Harness
status: in-progress
---
# CHANGE-0006: automatic-hoh-coding

Requirements: REQ-AUTOMATIC-HOH-CODING-001

## Intent

Make the shipped SDD entrypoint start Harness on Harness automatically for
top-level requests that require implementation code, while preserving direct
workflows for non-coding tasks and preventing nested HoH runs.

## Classification

Behavior change to the shipped GitHub Copilot CLI Skill instructions.

## Impact

- Add an explicit top-level coding-request routing rule to `sdd-change`.
- Use the complete user request as the HoH public prompt.
- Resume the durable HoH run one transition at a time with bounded no-progress
  detection and explicit terminal/action-required state handling.
- Fail explicitly instead of silently implementing outside HoH when automatic
  startup or continuation fails.
- Preserve direct SDD handling for non-coding and explicit existing-change
  continuation requests.
- Propagate the current HoH run ID to role subprocesses and reject nested
  `musubix4 run` invocations at the CLI boundary.
- Add a design artifact and trace annotations for the routing and nested-run
  guard responsibilities.
- Add deterministic distribution coverage for the routing contract.
- Document configured automatic routing, direct-workflow opt-out,
  `--summary-json`, and nested-orchestration rejection in both READMEs and the
  changelog.

## Evidence deviation

The first Red/Green cycle was executed successfully, but its implementation
checkpoint was recorded after Green. A second review-driven Red/Green cycle
then covered the final guard and Skill-safety edits after the original Green
checkpoint. The three approved change-evidence waivers for this change (nine
across CHANGE-0006 and CHANGE-0007 after CHANGE-0007's refresh) use an
abbreviated reason; the final
shipped fingerprints are instead supported by both passing focused cycles, the
subsequent full test suite, strict trace, graph gate, and changed quality gate.
The waivers acknowledge checkpoint chronology debt and do not claim that the
first bounded cycle alone covers the final source tree.
