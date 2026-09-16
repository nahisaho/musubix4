import { describe, expect, it } from "vitest";
import {
  parseHohConfig,
  validateMandatoryQaConfiguration,
  type MandatoryQaCheckId,
} from "../packages/analysis/src/hoh.js";

describe("mandatory QA configuration", () => {
  /** @id TEST-AUTONOMOUS-QA-CONFIG-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-015
   */
  it("TEST-AUTONOMOUS-QA-CONFIG-001 requires one executable command per mandatory check", () => {
    const ids: MandatoryQaCheckId[] = [
      "build",
      "focused-test",
      "static-validation",
      "trace",
      "dependency-cycle",
      "structured-contract",
      "inherited-compatibility",
    ];
    const qaChecks = Object.fromEntries(
      ids.map((id) => [id, ["node", "-e", `console.log("${id}")`]]),
    );
    const complete = parseHohConfig({
      model: "gpt-5.4",
      budget: { aiCredits: 10 },
      commands: { test: ["npm", "test"] },
      qaChecks,
    });
    expect(validateMandatoryQaConfiguration(complete)).toEqual(qaChecks);

    const incomplete = parseHohConfig({
      model: "gpt-5.4",
      budget: { aiCredits: 10 },
      commands: { test: ["npm", "test"] },
      qaChecks: {
        build: ["npm", "run", "build"],
      },
    });
    expect(() => validateMandatoryQaConfiguration(incomplete)).toThrow(
      /focused-test/,
    );
  });
});
