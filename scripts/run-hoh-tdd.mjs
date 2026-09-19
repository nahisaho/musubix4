import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const [testId, reportPath] = process.argv.slice(2);
const testFiles = [
  "tests/inherited-compatibility.test.ts",
  "tests/hoh-lifecycle.test.ts",
  "tests/autonomous-candidate-isolation-recorded-head.test.ts",
  "tests/autonomous-candidate-baseline-recovery.test.ts",
  "tests/autonomous-candidate-recovery-contract.test.ts",
  "tests/autonomous-candidate-release-review.test.ts",
  "tests/autonomous-candidate-release-hardening.test.ts",
  "tests/autonomous-conflicted-index-baseline.test.ts",
  "tests/autonomous-declared-surface-workspace.test.ts",
  "tests/autonomous-recovery-generic-failure.test.ts",
  "tests/autonomous-rejected-ref-cleanup.test.ts",
  "tests/autonomous-baseline-oracle.test.ts",
  "tests/autonomous-command-surface.test.ts",
  "tests/autonomous-command-surface-advanced.test.ts",
  "tests/autonomous-command-surface-loop.test.ts",
  "tests/autonomous-collision-inventory.test.ts",
  "tests/autonomous-amendment-fsm.test.ts",
  "tests/autonomous-amendment-cli.test.ts",
  "tests/autonomous-amendment-routing.test.ts",
  "tests/autonomous-amendment-git.test.ts",
  "tests/autonomous-amendment-approval.test.ts",
  "tests/autonomous-amendment-promotion.test.ts",
  "tests/autonomous-amendment-cli-promotion.test.ts",
  "tests/autonomous-amendment-approval-consumption.test.ts",
  "tests/autonomous-durability-limits.test.ts",
  "tests/autonomous-protected-set.test.ts",
  "tests/autonomous-protected-boundary.test.ts",
  "tests/autonomous-seven-check-qa.test.ts",
  "tests/autonomous-seven-check-orchestration.test.ts",
  "tests/autonomous-seven-check-adapter.test.ts",
  "tests/autonomous-seven-check-config.test.ts",
  "tests/autonomous-hoh-config-file.test.ts",
  "tests/autonomous-qa-mutation-routing.test.ts",
  "tests/autonomous-auto-approval-config.test.ts",
  "tests/autonomous-auto-release-approval.test.ts",
  "tests/autonomous-auto-amendment-approval.test.ts",
  "tests/autonomous-auto-spec-design-approval.test.ts",
  "tests/autonomous-auto-approval-retry.test.ts",
  "tests/autonomous-auto-approval-manifest-limit.test.ts",
  "tests/autonomous-auto-approval-rehash.test.ts",
  "tests/autonomous-auto-approval-nonce.test.ts",
  "tests/autonomous-auto-approval-least-privilege.test.ts",
  "tests/autonomous-auto-approval-reviewer-required.test.ts",
  "tests/autonomous-auto-approval-empty-manifest.test.ts",
  "tests/autonomous-auto-spec-design-manifest.test.ts",
  "tests/autonomous-auto-release-manifest.test.ts",
  "tests/autonomous-auto-approval-boundary-evidence.test.ts",
  "tests/autonomous-auto-approval-authority-escalation.test.ts",
  "tests/autonomous-auto-approval-authority-persistence.test.ts",
  "tests/autonomous-auto-approval-authority-sticky.test.ts",
  "tests/autonomous-auto-release-isolation.test.ts",
  "tests/autonomous-auto-approval-repair.test.ts",
  "tests/autonomous-auto-approval-review-repair.test.ts",
  "tests/autonomous-auto-amendment-repair.test.ts",
  "tests/optional-formal-gate.test.ts",
  "tests/structured-full-test-report.test.ts",
  "tests/structured-test-path-binding.test.ts",
  "tests/change-multi-requirement-test-annotation.test.ts",
  "tests/change-quality-refresh.test.ts",
  "tests/policy-command-definition-binding.test.ts",
  "tests/policy-command-closed-set.test.ts",
  "tests/policy-command-optional-binding.test.ts",
  "tests/cli-package.test.ts",
  "tests/release-documents.test.ts",
  "tests/release-version-consistency.test.ts",
  "tests/full-v1-acceptance.test.ts",
];
if (!testId || !reportPath) {
  const result = spawnSync(
    process.execPath,
    [
      resolve("node_modules/vitest/vitest.mjs"),
      "run",
      ...testFiles,
      "--maxWorkers=1",
    ],
    { cwd: resolve("."), encoding: "utf8", stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}
const rawPath = resolve(".test-work", `${testId}.vitest.json`);
mkdirSync(dirname(rawPath), { recursive: true });
const result = spawnSync(
  process.execPath,
  [
    resolve("node_modules/vitest/vitest.mjs"),
    "run",
    ...testFiles,
    "--maxWorkers=1",
    "--reporter=json",
    `--outputFile=${rawPath}`,
    "-t",
    testId,
  ],
  { cwd: resolve("."), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
let status = result.status === 0 ? "passed" : "failed";
try {
  const raw = JSON.parse(readFileSync(rawPath, "utf8"));
  const assertion = raw.testResults
    ?.flatMap((suite) => suite.assertionResults ?? [])
    .find((entry) => String(entry.title ?? entry.fullName).includes(testId));
  if (assertion?.status)
    status = assertion.status === "passed" ? "passed" : "failed";
} catch {
  status = result.status === 0 ? "passed" : "error";
}
const absoluteReport = resolve(reportPath);
mkdirSync(dirname(absoluteReport), { recursive: true });
writeFileSync(
  absoluteReport,
  `${JSON.stringify({
    schemaVersion: 1,
    tests: [{ id: testId, status }],
  })}\n`,
);
rmSync(rawPath, { force: true });
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exit(result.status ?? 1);
