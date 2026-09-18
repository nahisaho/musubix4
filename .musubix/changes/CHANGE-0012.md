---
schemaVersion: 1
id: CHANGE-0012
summary: Restore HoH Developer tool access
status: in-progress
---
# CHANGE-0012: hoh-developer-tool-access

Requirements: REQ-AUTONOMOUS-DEVELOPMENT-013

## Intent

Restore the HoH Developer role's ability to inspect and edit repository files
and execute policy-bounded project commands with the current Copilot CLI.

## Classification

Defect correction with clarified measurable acceptance for
REQ-AUTONOMOUS-DEVELOPMENT-013. REQ-AUTONOMOUS-DEVELOPMENT-005 and
REQ-AUTONOMOUS-DEVELOPMENT-006 are affected unchanged context:
REQ-AUTONOMOUS-DEVELOPMENT-005 requires the Developer execution-record output
contract, and REQ-AUTONOMOUS-DEVELOPMENT-006 requires Developer-produced
workspace and candidate changes.

## Failure evidence

HoH Developer session `7a185ebd-e075-46ef-82e0-3aeb3b0b78eb` returned a
blocked execution record because no repository or file-editing tool
interface was available. This identifier is a local Copilot subprocess session,
not a `.musubix4/runs` artifact. Its persisted turn records that the effective
arguments passed permission kinds `read` and `edit` as concrete
`--available-tools` names. A post-fix probe against Copilot CLI 1.0.86
confirmed `view`, `grep`, and `glob` for read availability and `apply_patch`
for file mutation, while `write` is the file-mutation permission kind for
`--allow-tool`. The same probe rejected `edit` and `create` as unknown names. A direct probe also confirmed
that `copilot --version` prints `GitHub Copilot CLI 1.0.86` while
`copilot --no-auto-update --version` resolves to incompatible 0.0.420.

## Impact

- Separate Copilot concrete tool names from permission kinds.
- Map read capability to `view`, `grep`, and `glob`, and Developer write
  capability to `apply_patch` in `--available-tools`.
- Use `write` only as the Developer `--allow-tool` permission kind.
- Treat `allowTools` as a closed `read`/`write` capability vocabulary and
  reject unknown or contradictory write capability overrides before spawn.
- Preserve `allowWrite` for bounded QA provisioning and deployment adapters;
  without Developer `allowTools: write` it never grants a Copilot mutation
  tool.
- Keep Copilot `bash` unavailable and deny permission kind `shell` for every
  role; `allowProjectCommands` continues to govern bounded subprocess adapters.
- Reject current-protocol unknown-tool configuration events.
- Remove the version-switching `--no-auto-update` argument so version probing
  and role execution use the same configured executable path.
- Remove inherited `COPILOT_AUTO_UPDATE` from the probe/spawn environment and
  require the verified Copilot CLI 1.0.86 or newer before reserving role credits.
- Probe before every retry attempt even when `copilotCliVersion` is not
  configured; this adds one bounded version subprocess and CommandRecord to the
  invocation adapter result per role attempt.
- Reject persisted policy overrides that still use the obsolete concrete
  `edit` token; no automatic migration is performed for the closed
  `read | write` capability vocabulary.
- Keep other role write restrictions and residual-risk behavior unchanged;
  record the intentional Developer default policy-digest change.
- Preserve explicit policy overrides, policy digests, residual-risk reporting,
  path containment, network denial, secret handling, and argument-array spawn.
- Add focused Red-Green coverage for concrete availability names, permission
  kinds, project-command allow/deny behavior, invalid capability rejection,
  unknown-tool events, version-neutral role arguments, inherited environment
  removal, and minimum-version rejection.

## Real CLI verification

Copilot CLI 1.0.86 session `305e29b5-f098-46cc-9c43-2e522929970a` with
`gpt-5.4` successfully created `output.txt` through
`--available-tools view grep glob apply_patch --allow-tool write --deny-tool
shell`, and read-only session `99639f83-7de8-477e-8475-97b5f2887e80`
successfully read the file through
`--available-tools view grep glob --deny-tool shell`. The earlier
`edit`/`create` probe in session `3966af56-1042-45a4-b401-b3486d7fe4f7`
emitted typed unknown-tool configuration events and did not create the file.

Residual risk: the immediate version probe establishes only the executable
version observed before role spawn. Because current-protocol JSONL does not
repeat the CLI version and automatic update is not disabled, deployments that
require exact equality must externally pin the executable installation and
path.

## Waivers

`nahisaho` approved bounded `CHANGE_RED_UNPROVEN`,
`CHANGE_GREEN_UNPROVEN`, and `CHANGE_COMPLETENESS_TDD` waivers for
CHANGE-0012 because its change-phase checkpoints were recorded after the
initial valid Red-Green cycle. The waiver covers only checkpoint chronology;
TEST-HOH-COPILOT-ADAPTER-007 and five supporting version-probe tests have
genuine Red-Green evidence, and the complete typecheck, build, test, package,
trace, and graph checks remain required.

## Bootstrap note

HoH cannot implement this correction because its Developer role currently has
no usable write tool. Focused run `fddd87df-2bad-4241-9f87-588a2c9a3609`
captured `aiCredits: 500` in its immutable run configuration; the working-copy
`.musubix/hoh.json` was then restored to the committed `aiCredits: 100` content
before Developer execution so the budget edit could not contaminate its
candidate. The intended `aiCredits: 500` setting will be restored only after
this bootstrap correction passes final verification.
