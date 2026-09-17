---
schemaVersion: 1
id: CHANGE-0009
summary: Support current Copilot semantic anchors in HoH role output
status: in-progress
---
# CHANGE-0009: hoh-copilot-status-event

Requirements: REQ-AUTONOMOUS-DEVELOPMENT-004

## Intent

Allow HoH role invocations to consume the current GitHub Copilot CLI JSONL
protocol instead of rejecting its lifecycle events or requiring the legacy
synthetic usage/result envelope.

## Classification

Defect correction with a clarified observable compatibility requirement. The
fixed-model and metering contract remains unchanged, but its acceptance
criteria now define both the legacy and current protocols while preserving
fail-closed validation of every semantic field that can affect metering, model
identity, role output, or process success. Unrecognized well-formed events are
evidence-only and cannot influence those decisions.

## Impact

- Update `REQ-AUTONOMOUS-DEVELOPMENT-004` to select the current protocol when
  current semantic anchors exist and otherwise require the complete legacy
  envelope, derive AI credits from monotonic cumulative integer nano-AIU,
  validate final-answer model metadata, and parse the last final assistant
  message as JSON role output.
- Update `DES-AUTONOMOUS-DEVELOPMENT-006` with an explicit JSONL event
  classification boundary.
- Add a focused Red-Green regression test to the Copilot role adapter.
- Preserve rejection of malformed JSONL, incomplete legacy semantics, invalid
  or decreasing current usage, invalid selected role output,
  unsuccessful/non-final results, truncated process output, model drift, and
  budget violations.
  Preserve legacy reasoning/version drift checks where the legacy usage event
  provides those fields.
- Retain accepted events in received order after secret redaction under the
  existing process-output byte bound while treating non-semantic events as
  evidence-only.
- Restore `.musubix/hoh.json` and rerun the quality gate with the protected
  configuration present before release.

## Bootstrap note

HoH run `1b54970b-6207-4287-9518-e05b74787f0e` failed at iteration 0 because
the current HoH parser first rejected `session.mcp_server_status_changed`.
Inspection of a real Copilot CLI 1.0.86-2 transcript then confirmed that the
current protocol also uses multiple lifecycle events, cumulative nano-AIU
usage checkpoints, and final assistant-message content instead of the legacy
synthetic envelope. The user explicitly approved temporarily removing
`.musubix/hoh.json` so this startup path can be repaired through the normal SDD
workflow. The configuration will be restored before final verification.

`tests/fixtures/copilot-cli-1.0.86-role-output.jsonl`, SHA-256
`6bc225583a40a8a7e9c3f8bccf09bfaabdba14e2883f0dc9b56968c311107ab3`, is a
privacy-minimized copy of the observed stdout event sequence. Session
identifiers, timestamps, prompt content, encrypted content, reasoning text, and
cache-break data are removed or replaced while event names and semantic field
locations are preserved.

The observed non-interactive `--output-format json --stream off` run emits the
complete final answer in one `assistant.message` and terminates with one final
top-level `result.exitCode`. Routine `session.shutdown` support remains part of
the separate general workflow-transcript verifier and is not inferred for this
role-output protocol without a captured stdout example.

The first `impact` checkpoint was recorded after the initial requirements
draft, so the append-only recorder correctly rejected the first requirements
checkpoint as unchanged. The acceptance wording was then clarified before the
successful requirements checkpoint; the early ordering defect remains visible
in evidence. It produced no current gate diagnostic and therefore required no
waiver.

The first Green attempt was invalid because the new test configured
`roleOutputRetryLimit: 0`, which the existing configuration contract rejects
before exercising the target behavior. After correcting the test configuration
its fingerprint changed, so the current-protocol branch was deliberately
disabled to record a fresh real Red, then restored for the passing Green.
The immutable checkpoint chronology is covered by approved append-only
`CHANGE_TEST_CHANGED_AFTER_RED`, `CHANGE_RED_UNPROVEN`,
`CHANGE_GREEN_UNPROVEN`, and `CHANGE_COMPLETENESS_TDD` waivers scoped to
`REQ-AUTONOMOUS-DEVELOPMENT-004`; the waivers do not replace the final real
Red/Green evidence.

Final release review added `TEST-HOH-COPILOT-ADAPTER-005`, which records a
separate valid Red/Green cycle proving exact nano-AIU propagation, reserved
usage fallback when the current stream has no checkpoint, and fail-closed
handling of truncated JSONL. This cycle postdates the append-only quality
checkpoint. The final review then found that custom executable paths skipped
the version probe and that an over-budget parsed usage was abandoned before its
exact usage was settled. `TEST-HOH-COPILOT-ADAPTER-004` and
`TEST-HOH-COPILOT-ADAPTER-005` received fresh real Red/Green cycles proving
same-path version probing and settle-before-stop budget accounting. The
implementation now records the exact nano-AIU overrun and the store's
`budget-exhausted` transition before rejecting the role result.

The append-only CHANGE-0009 waiver history records
`CHANGE_TEST_CHANGED_AFTER_RED` at order 406 and refreshed
`CHANGE_RED_UNPROVEN`, `CHANGE_GREEN_UNPROVEN`, and
`CHANGE_COMPLETENESS_TDD` snapshots at orders 407-409, 412-414, 417-419, and
424-426. Orders 424-426 cover the review-driven same-path version-probe and
settle-before-stop budget-accounting cycles; later append-only refresh records,
if required by final artifact edits, retain the same approved scope.
These records disclose immutable phase-checkpoint chronology while the latest
focused cycles and full validation remain authoritative execution evidence.
The workflow waiver batch at sequences 92-107 covers only historical
cross-session declaration binding/order diagnostics after compatible
verification of the current bootstrap workflow.

The persisted `quality` checkpoint predates the final review-driven test and
implementation changes, so readiness relies on the subsequently regenerated
TDD, command, trace, graph, gate, and exact-hash approval evidence rather than
claiming that checkpoint is current. The change remains `in-progress` until
the mandatory release approval is recorded.

Legacy run files that predate `usageNanoAiu` are loaded by converting their
historical floating-point credit display value. Exact integer nano-AIU is
preserved for all newly parsed and persisted current-protocol usage; historical
records cannot recover precision that was not originally stored.
