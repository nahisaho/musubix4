import { expect, it } from "vitest";
import {
  loadConfig,
  loadPolicyBaseline,
  policyDiagnostics,
} from "../packages/analysis/src/index.js";
import { project } from "./helpers.js";

/** @id TEST-POLICY-COMMAND-OPTIONAL-BINDING-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-001
 */
it("TEST-POLICY-COMMAND-OPTIONAL-BINDING-001 closes and binds the command allowlist even without requiredCommands", async () => {
  const root = await project();
  const config = await loadConfig(root);
  const baseline = await loadPolicyBaseline(root);
  expect(baseline).not.toBeNull();
  baseline!.commands = config.commands.map((command) => ({
    ...command,
    args: [...command.args],
  }));
  baseline!.requiredCommands = [];

  config.commands.push({
    name: "unreviewed",
    command: "node",
    args: ["-e", "process.exit(0)"],
    required: false,
    timeoutMs: 1000,
  });
  expect(
    policyDiagnostics(config, baseline!).filter(
      (diagnostic) => diagnostic.code === "POLICY_COMMAND_UNLISTED",
    ),
  ).toHaveLength(1);

  config.commands.pop();
  config.commands[0]!.args = ["-e", "process.exit(0)"];
  expect(policyDiagnostics(config, baseline!)).toContainEqual(
    expect.objectContaining({ code: "POLICY_COMMAND_DEFINITION" }),
  );
});
