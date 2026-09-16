import { describe, expect, it } from "vitest";
import * as hoh from "../packages/analysis/src/hoh.js";

describe("deterministic seven-check QA", () => {
  /** @id TEST-AUTONOMOUS-QA-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-008 REQ-AUTONOMOUS-DEVELOPMENT-015
   */
  it("TEST-AUTONOMOUS-QA-001 derives exhaustive claims from all mandatory checks", () => {
    const evaluateSevenCheckQa = (
      hoh as typeof hoh & {
        evaluateSevenCheckQa?: (
          requirements: string[],
          checks: Array<{
            id: string;
            status: "passed" | "failed";
            evidence: string[];
          }>,
        ) => {
          claims: Array<{
            claimId: string;
            status: "verified" | "gap" | "insufficient-evidence";
            evidence: string[];
          }>;
          verified: Array<{ claimId: string }>;
          unresolved: Array<{ claimId: string }>;
          readiness: boolean;
        };
      }
    ).evaluateSevenCheckQa;
    const checks = [
      "build",
      "focused-test",
      "static-validation",
      "trace",
      "dependency-cycle",
      "structured-contract",
      "inherited-compatibility",
    ].map((id) => ({
      id,
      status: "passed" as const,
      evidence: [`evidence://${id}`],
    }));

    expect(evaluateSevenCheckQa).toBeTypeOf("function");
    const complete = evaluateSevenCheckQa!(
      ["REQ-AUTONOMOUS-DEVELOPMENT-001", "REQ-AUTONOMOUS-DEVELOPMENT-008"],
      checks,
    );
    expect(complete.claims).toHaveLength(14);
    expect(complete.verified).toHaveLength(14);
    expect(complete.unresolved).toHaveLength(0);
    expect(complete.readiness).toBe(true);
    expect(new Set(complete.claims.map((claim) => claim.claimId)).size).toBe(14);

    const incomplete = evaluateSevenCheckQa!(
      ["REQ-AUTONOMOUS-DEVELOPMENT-008"],
      checks.filter((check) => check.id !== "static-validation"),
    );
    expect(incomplete.readiness).toBe(false);
    expect(incomplete.unresolved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "insufficient-evidence",
          evidence: ["missing-check:static-validation"],
        }),
      ]),
    );

    const failed = evaluateSevenCheckQa!(
      ["REQ-AUTONOMOUS-DEVELOPMENT-008"],
      checks.map((check) =>
        check.id === "inherited-compatibility"
          ? { ...check, status: "failed" as const }
          : check,
      ),
    );
    expect(failed.unresolved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "gap",
          evidence: ["evidence://inherited-compatibility"],
        }),
      ]),
    );
  });
});
