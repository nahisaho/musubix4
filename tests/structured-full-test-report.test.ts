import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fixture } from "./helpers.js";

/** @id TEST-STRUCTURED-FULL-TEST-REPORT-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-016
 */
describe("structured full test report", () => {
  it("TEST-STRUCTURED-FULL-TEST-REPORT-001 emits authoritative TEST IDs from the executed Vitest suite", async () => {
    const root = await fixture();
    const reportPath = resolve(root, "test-results.json");
    const result = spawnSync(
      process.execPath,
      [
        "scripts/run-full-tests.mjs",
        "--report",
        reportPath,
        "--files",
        "tests/autonomous-auto-approval-config.test.ts",
      ],
      { cwd: resolve("."), encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    const report = JSON.parse(await readFile(reportPath, "utf8")) as {
      schemaVersion: number;
      tests: Array<{ id: string; status: string }>;
    };
    expect(report.schemaVersion).toBe(1);
    expect(report.tests).toContainEqual({
      id: "TEST-AUTONOMOUS-AUTO-APPROVAL-CONFIG-001",
      status: "passed",
    });
  });
});
