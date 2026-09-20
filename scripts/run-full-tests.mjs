import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

/** @id CODE-STRUCTURED-FULL-TEST-REPORT-001
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-016
 * @design DES-AUTONOMOUS-DEVELOPMENT-015
 */

const args = process.argv.slice(2);
let reportPath;
let files = [];

for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--report") {
    reportPath = args[index + 1];
    index += 1;
    continue;
  }
  if (argument === "--files") {
    while (args[index + 1] && !args[index + 1].startsWith("--")) {
      files.push(args[index + 1]);
      index += 1;
    }
    continue;
  }
  throw new Error(`Unknown argument: ${argument}`);
}

if (!reportPath) throw new Error("--report is required.");

const rawPath = resolve(".test-work", `full-tests-${process.pid}.vitest.json`);
/** @id CODE-SAFE-WORKFLOW-SPEED-005
 * @implements REQ-SAFE-WORKFLOW-SPEED-003
 * @design DES-SAFE-WORKFLOW-SPEED-005
 */
const performanceTestPath = "tests/safe-workflow-performance.test.ts";
const requiresPerformanceEvidence =
  files.length === 0 || files.includes(performanceTestPath);
const performanceNonce = randomUUID();
const performanceSidecar = resolve(
  ".test-work",
  `graph-performance-${process.pid}-${performanceNonce}.json`,
);
const absoluteReport = resolve(reportPath);
mkdirSync(dirname(rawPath), { recursive: true });
rmSync(absoluteReport, { force: true });
rmSync(performanceSidecar, { force: true });

const result = spawnSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  [
    "test",
    "--",
    ...files,
    "--maxWorkers=2",
    "--reporter=json",
    `--outputFile=${rawPath}`,
  ],
  {
    cwd: resolve("."),
    encoding: "utf8",
    env: {
      ...process.env,
      MUSUBIX_GRAPH_PERFORMANCE_NONCE: performanceNonce,
      MUSUBIX_GRAPH_PERFORMANCE_SIDECAR: performanceSidecar,
    },
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 270_000,
  },
);

let failure;
try {
  if (result.error) throw result.error;
  const raw = JSON.parse(readFileSync(rawPath, "utf8"));
  const testsById = new Map();
  const testFiles = {};
  const testCounts = new Map();
  const errors = [];
  const severity = { passed: 0, skipped: 1, failed: 2, error: 3 };

  for (const suite of raw.testResults ?? []) {
    for (const assertion of suite.assertionResults ?? []) {
      const name = String(assertion.fullName ?? assertion.title ?? "");
      const ids = [
        ...new Set(
          [
            ...name.matchAll(
              /(?:^|[^A-Za-z0-9])(TEST[-_](?!TEST[-_])[A-Z0-9_-]*\d{3,})(?![0-9])/g,
            ),
          ].map((match) => match[1].replaceAll("_", "-")),
        ),
      ];
      if (ids.length === 0) continue;
      if (ids.length > 1) {
        errors.push(`Executed test has multiple TEST IDs: ${name}`);
        continue;
      }
      const id = ids[0];
      testCounts.set(id, (testCounts.get(id) ?? 0) + 1);
      const testPath = relative(resolve("."), resolve(suite.name)).replaceAll(
        "\\",
        "/",
      );
      if (!testPath || testPath.startsWith("../")) {
        errors.push(`Executed TEST ID has an invalid source path: ${id}`);
        continue;
      }
      if (testFiles[id] && testFiles[id] !== testPath) {
        errors.push(
          `TEST ID ${id} was executed from multiple source paths: ${testFiles[id]}, ${testPath}`,
        );
        continue;
      }
      testFiles[id] = testPath;
      const rawStatus = String(assertion.status).toLowerCase();
      const status =
        rawStatus === "passed"
          ? "passed"
          : ["pending", "skipped", "todo", "disabled"].includes(rawStatus)
            ? "skipped"
            : rawStatus === "failed"
              ? "failed"
              : "error";
      const previous = testsById.get(id);
      if (!previous || severity[status] > severity[previous.status]) {
        testsById.set(id, { id, status });
      }
    }
  }

  const tests = [...testsById.values()];
  if (tests.length === 0) errors.push("Vitest reported no executed TEST IDs.");
  if (errors.length > 0) throw new Error(errors.join("\n"));
  if (result.status !== 0) {
    const failures = (raw.testResults ?? [])
      .flatMap((suite) =>
        (suite.assertionResults ?? [])
          .filter((assertion) => assertion.status === "failed")
          .map(
            (assertion) =>
              `${assertion.fullName ?? assertion.title ?? suite.name}: ${(assertion.failureMessages ?? []).join("\n")}`,
          ),
      )
      .join("\n");
    throw new Error(
      `Vitest failed with exit ${result.status ?? "none"}${result.signal ? ` (${result.signal})` : ""}.${failures ? `\n${failures}` : ""}`,
    );
  }

  if (requiresPerformanceEvidence) {
    const performanceId = "TEST-SAFE-WORKFLOW-SPEED-004";
    const performanceEntry = testsById.get(performanceId);
    if (!performanceEntry || testCounts.get(performanceId) !== 1) {
      throw new Error(
        `Performance sidecar ${performanceSidecar} requires exactly one executed ${performanceId}; regenerate with node scripts/run-full-tests.mjs --report <path>.`,
      );
    }
    let sidecar;
    try {
      sidecar = JSON.parse(readFileSync(performanceSidecar, "utf8"));
    } catch (cause) {
      throw new Error(
        `Performance sidecar ${performanceSidecar} is missing or unreadable; regenerate with node scripts/run-full-tests.mjs --report <path>. ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    if (
      sidecar?.schemaVersion !== 1
      || sidecar.nonce !== performanceNonce
      || sidecar.testId !== performanceId
      || !sidecar.operations
      || !Number.isInteger(sidecar.operations.typescriptProgramBuilds)
      || sidecar.operations.typescriptProgramBuilds < 0
    ) {
      throw new Error(
        `Performance sidecar ${performanceSidecar} is malformed or stale; regenerate with node scripts/run-full-tests.mjs --report <path>.`,
      );
    }
    performanceEntry.operations = {
      typescriptProgramBuilds: sidecar.operations.typescriptProgramBuilds,
    };
  }

  mkdirSync(dirname(absoluteReport), { recursive: true });
  writeFileSync(
    absoluteReport,
    `${JSON.stringify({
      schemaVersion: 1,
      tests: tests.sort((left, right) => left.id.localeCompare(right.id)),
      testFiles: Object.fromEntries(
        Object.entries(testFiles).sort(([left], [right]) =>
          left.localeCompare(right),
        ),
      ),
    })}\n`,
  );
} catch (cause) {
  failure = cause;
} finally {
  rmSync(rawPath, { force: true });
  rmSync(performanceSidecar, { force: true });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
}

if (failure) {
  process.stderr.write(
    `${failure instanceof Error ? failure.message : String(failure)}\n`,
  );
  process.exit(1);
}
