---
schemaVersion: 1
feature: release-v010-docs
---
# v0.1.0 release documentation / v0.1.0 リリース文書

## REQ-RELEASE-V010-DOCS-001: Publish a concise English entry point
Priority: must
Type: functional
Pattern: state-driven
Statement: While the authoritative root package version is 0.1.0, the system shall ship a newly authored English README that presents musubix4 as a GitHub Copilot CLI extension for evidence-driven specification development.
Acceptance: `README.md` shall begin with `# musubix4` followed by an exact `**Latest release v0.1.0 ` marker; contain the headings `## Why musubix4`, `## Install`, `## Workflow`, `## Verification`, `## Evidence reference`, and `## Limitations`; contain the command tokens `npm install --save-dev --save-exact musubix4@0.1.0`, `npx --no-install musubix4 init`, `copilot plugin install nahisaho/musubix4`, `requirements validate`, `design validate`, `trace check --strict`, `graph gate`, `gate --changed`, and `approval prepare release`; contain the exact sentence `The npm and repository/plugin commands become usable after v0.1.0 is published to the corresponding registry and repository.`; the Evidence reference shall contain `--allow-unchanged`, `` `order` ``, `` `recordedAt` ``, `TDD_REQUIREMENT_UNCOVERED`, `workflow waiver record-all`, `all-or-nothing`, `WORKFLOW_INVOCATION_UNVERIFIED`, and `Attestation evidence-head composition`; the Limitations section shall contain the exact fragments `musubix4 does not replace GitHub Copilot`, `does not add another agent runtime`, and `does not treat SAT as proof of implementation correctness`; contain repository-relative links to `README-ja.md`, `CHANGELOG.md`, and `LICENSE`; and contain exactly one `**Latest release v...` marker.

## REQ-RELEASE-V010-DOCS-002: Publish a semantically equivalent Japanese entry point
Priority: must
Type: functional
Pattern: state-driven
Statement: While the authoritative root package version is 0.1.0, the system shall ship a newly authored Japanese README that communicates the same installation, workflow, verification, and limitation contract as the English README.
Acceptance: `README-ja.md` shall begin with `# musubix4` followed by an exact `**最新リリース v0.1.0 ` marker; contain the headings `## musubix4 が必要な理由`, `## インストール`, `## ワークフロー`, `## 検証`, `## 証拠リファレンス`, and `## 制限事項`; contain every command token required by REQ-RELEASE-V010-DOCS-001; contain the exact sentence `npmおよびrepository/pluginコマンドは、v0.1.0が対応するregistryとrepositoryへ公開された後に利用可能になります。`; the 証拠リファレンス shall contain the same required evidence tokens enumerated by REQ-RELEASE-V010-DOCS-001; the 制限事項 section shall contain the exact fragments `musubix4はGitHub Copilotを置き換えず`, `別のagent runtimeを追加せず`, and `SATを実装の正しさの証明として扱いません`; contain repository-relative links to `README.md`, `CHANGELOG.md`, and `LICENSE`; and contain exactly one `**最新リリース v...` marker.

## REQ-RELEASE-V010-DOCS-003: Establish a clean initial changelog
Priority: must
Type: functional
Pattern: state-driven
Statement: While the authoritative root package version is 0.1.0, the system shall publish CHANGELOG.md as the approved initial-release baseline rather than as a continuation of prerelease development entries.
Acceptance: `CHANGELOG.md` shall contain exactly one semantic-version release heading, `## 0.1.0 - 2026-09-16`; contain the section labels `Skills`, `Deterministic evidence`, `Distribution`, and `Limitations`; name `sdd-change`, requirements, design, trace, TDD, Code Graph, formal, quality gate, npm, and GitHub Copilot CLI plugin distribution; and contain no other `##` heading whose first token is a semantic version or prerelease.

## REQ-RELEASE-V010-DOCS-004: Align every release surface to v0.1.0
Priority: must
Type: functional
Pattern: state-driven
Statement: While preparing the initial public release, the system shall set the authoritative root package version to 0.1.0.
Acceptance: With the root package authority set to 0.1.0, the deterministic repository and packed-archive verifiers defined by REQ-AUTONOMOUS-DEVELOPMENT-019 shall report 0 mismatches, and a focused test shall fail when any governed release surface retains the stale value 0.1.18.

## REQ-RELEASE-V010-DOCS-005: Ship self-consistent Skills and workflow declarations
Priority: must
Type: functional
Pattern: state-driven
Statement: While the authoritative root package version is 0.1.0, the system shall make every shipped SDD Skill identify and invoke musubix4 rather than an inherited musubix3 identity.
Acceptance: A deterministic test shall scan every `.github/skills/sdd-*/SKILL.md` and report 0 `musubix3` tokens, at least one `musubix4` token in each Skill, and 0 `npx` command lines whose package argument matches `musubix*` but is not `musubix4`; Skills have no prose-lineage exception. The same test shall resolve each root `package.json#/files` entry against the working tree, recurse directory entries, include single-file entries, select regular UTF-8 text files, and fail unless the resulting non-empty set includes every Skill plus `README.md`, `README-ja.md`, `plugin.json`, and `.github/plugin/marketplace.json`. In those files, a stale command invocation is either `npx` followed by zero or more option tokens and package argument `musubix3`, an inline-code span whose first token is `musubix3`, or a fenced-code line where `musubix3` is the first shell word at line start or after `;`, `&&`, or `||`; the test shall report 0 stale command invocations, while `musubix3` occurrences outside those command positions are permitted as prose or compatibility lineage. The same stale-command rule shall report 0 matches across all regular UTF-8 text entries in the generated npm archive. Newly appended workflow declaration version consistency is owned exclusively by REQ-AUTONOMOUS-DEVELOPMENT-019.
