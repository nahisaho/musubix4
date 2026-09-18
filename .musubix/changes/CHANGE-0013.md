# CHANGE-0013: copilot-version-sentence-punctuation

Requirements: REQ-AUTONOMOUS-DEVELOPMENT-013

## Intent

Restore HoH startup when the real Copilot CLI renders its semantic version with
a sentence-ending period, as in `GitHub Copilot CLI 1.0.86.`.

## Classification

Defect correction with a clarified version-probe normalization rule.

## Failure evidence

Fresh HoH run `73df8528-638d-4322-a598-ab91eafac4c6` failed before its first
Planner reservation with:

`Unparsable Copilot CLI version output: GitHub Copilot CLI 1.0.86.` followed
on stdout by `Run 'copilot update' to check for updates.`

## Impact

- Parse only a bare semantic-version line or the exact
  `GitHub Copilot CLI <semantic-version>` banner, allowing one sentence-ending
  period after the version.
- Keep configured `copilotCliVersion` strict and undecorated.
- Continue rejecting prefixes, internal punctuation, closing delimiters, and
  any other decorated token.
- Add a focused regression using the observed real CLI output shape.

## Bootstrap note

The configured HoH runtime cannot implement this correction because the defect
prevents the first Planner invocation. This bounded change therefore uses the
normal SDD workflow before starting a new HoH release run.

## Resolution

- Replaced whitespace-token version discovery with ordered LF/CRLF line
  processing.
- Trimmed only ASCII whitespace from each line and removed at most one final
  ASCII period before matching.
- Accepted only a bare anchored semantic version or the exact case-sensitive
  `GitHub Copilot CLI <semantic-version>` banner.
- Preserved prerelease and build suffixes for configured-version equality and
  diagnostics while continuing to compare the numeric triple to minimum 1.0.86.
- Kept configured `copilotCliVersion` strict: no banner or period normalization.

## Verification

- `TEST-HOH-COPILOT-ADAPTER-007`: genuine failing Red followed by passing Green.
- Configured `hoh-test`, `typecheck`, `build`, and `test` commands: passed.
- Annotated test identities: 243/243 passed in the retained structured report.
- Trace and strict Code Graph checks: passed with no error diagnostics.
- Formal consistency: valid, but REQ-AUTONOMOUS-DEVELOPMENT-013 remains outside
  the supported abstraction and SAT is not behavioral proof.
- The current pre-release gate passes every required non-approval check and
  remains failed until a release approval is recorded for the final manifest.

## Evidence limitations

- Current-session workflow declarations cannot be terminally reconciled until
  session shutdown. A retained completed transcript was verified and the
  35 remaining declaration-scoped diagnostics were recorded as scope-bounded,
  non-expiring waivers.
- Reusing `TEST-HOH-COPILOT-ADAPTER-007` causes the change-history selector to
  also observe older pre-monotonic evidence. CHANGE-0013 has ordered design,
  Red, implementation, Green, and quality checkpoints plus a fresh bounded
  Red-Green cycle; only that historical selection ambiguity is waived.
