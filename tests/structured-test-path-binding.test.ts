import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadConfig,
  runGate,
  writeJson,
  type Config,
} from "../packages/analysis/src/index.js";
import { fixture, project } from "./helpers.js";

/** @id TEST-STRUCTURED-TEST-PATH-BINDING-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-016
 */
describe("structured test path binding", () => {
  it("TEST-STRUCTURED-TEST-PATH-BINDING-001 binds executed IDs to their authoritative trace paths", async () => {
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
      { cwd: resolve("."), encoding: "utf8", timeout: 120_000 },
    );

    expect(result.status).toBe(0);
    const report = JSON.parse(await readFile(reportPath, "utf8")) as {
      testFiles: Record<string, string>;
    };
    expect(report.testFiles["TEST-AUTONOMOUS-AUTO-APPROVAL-CONFIG-001"]).toBe(
      "tests/autonomous-auto-approval-config.test.ts",
    );

    const projectRoot = await project();
    const config = (await loadConfig(projectRoot)) as Config;
    config.commands[0]!.args = [
      "-e",
      "const fs=require('fs'),p=process.argv[1];fs.mkdirSync(require('path').dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify({schemaVersion:1,tests:[{id:'TEST-EXAMPLE-001',status:'passed'}],testFiles:{'TEST-EXAMPLE-001':'src/wrong.test.ts'}}))",
      "{reportPath}",
    ];
    await writeJson(projectRoot, ".musubix/config.json", config);

    const gate = await runGate(projectRoot);
    expect(
      gate.checks.find((check) => check.name === "test-identities")
        ?.diagnostics,
    ).toContainEqual(
      expect.objectContaining({ code: "TEST_REPORT_PATH_MISMATCH" }),
    );
  });
});
