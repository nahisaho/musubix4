import { describe, expect, it } from "vitest";
import {
  derivePolicy,
  runMandatoryProjectChecks,
  type MandatoryQaCheckId,
} from "../packages/analysis/src/hoh.js";
import { fixture } from "./helpers.js";

describe("mandatory QA command adapter", () => {
  /** @id TEST-AUTONOMOUS-QA-ADAPTER-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-015
   */
  it("TEST-AUTONOMOUS-QA-ADAPTER-001 executes all seven checks with bounded evidence", async () => {
    const root = await fixture();
    const ids: MandatoryQaCheckId[] = [
      "build",
      "focused-test",
      "static-validation",
      "trace",
      "dependency-cycle",
      "structured-contract",
      "inherited-compatibility",
    ];
    const commands = Object.fromEntries(
      ids.map((id) => [
        id,
        [
          process.execPath,
          "-e",
          id === "trace"
            ? "console.error('trace failed');process.exit(2)"
            : `console.log('${id}:ok')`,
        ],
      ]),
    ) as Record<MandatoryQaCheckId, string[]>;

    const checks = await runMandatoryProjectChecks({
      cwd: root,
      commands,
      timeoutMs: 10000,
      maxOutputBytes: 4096,
      policy: derivePolicy("qa", {}),
    });
    expect(checks).toHaveLength(7);
    expect(checks.map((check) => check.id)).toEqual(ids);
    expect(checks.find((check) => check.id === "trace")).toMatchObject({
      status: "failed",
      evidence: expect.arrayContaining([
        expect.stringContaining("exitCode=2"),
        expect.stringContaining("trace failed"),
      ]),
    });
    expect(
      checks.filter((check) => check.id !== "trace"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "passed",
          evidence: expect.arrayContaining([
            expect.stringContaining(":ok"),
          ]),
        }),
      ]),
    );
  });
});
