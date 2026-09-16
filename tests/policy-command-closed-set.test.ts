import { expect, it } from "vitest";
import {
  loadConfig,
  loadPolicyBaseline,
  parseHohConfig,
  parsePolicyBaseline,
  policyDiagnostics,
} from "../packages/analysis/src/index.js";
import { project } from "./helpers.js";

/** @id TEST-POLICY-COMMAND-CLOSED-SET-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-001
 */
it("TEST-POLICY-COMMAND-CLOSED-SET-001 requires complete definitions and rejects unlisted commands without HOH false positives", async () => {
  const root = await project();
  const config = await loadConfig(root);
  config.hoh = parseHohConfig({
    model: "gpt-5.4",
    budget: { aiCredits: 10 },
    commands: { test: ["npm", "test"] },
  });
  const baseline = await loadPolicyBaseline(root);
  expect(baseline).not.toBeNull();
  baseline!.commands = config.commands.map((command) => ({
    ...command,
    args: [...command.args],
  }));
  baseline!.requiredCommands = config.commands.map((command) => command.name);

  expect(
    policyDiagnostics(config, baseline!).filter((diagnostic) =>
      diagnostic.code.startsWith("POLICY_COMMAND"),
    ),
  ).toEqual([]);

  config.commands.push({
    name: "unreviewed",
    command: "node",
    args: ["-e", "process.exit(0)"],
    required: true,
    timeoutMs: 1000,
  });
  expect(policyDiagnostics(config, baseline!)).toContainEqual(
    expect.objectContaining({ code: "POLICY_COMMAND_UNLISTED" }),
  );

  expect(() =>
    parsePolicyBaseline({
      schemaVersion: 1,
      ...baseline,
      commands: [],
      requiredCommands: ["test"],
    }),
  ).toThrow(/requiredCommands.*definition/i);
});
