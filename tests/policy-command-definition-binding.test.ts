import { expect, it } from "vitest";
import {
  loadConfig,
  loadPolicyBaseline,
  policyDiagnostics,
} from "../packages/analysis/src/index.js";
import { project } from "./helpers.js";

/** @id TEST-POLICY-COMMAND-DEFINITION-BINDING-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-001
 */
it("TEST-POLICY-COMMAND-DEFINITION-BINDING-001 rejects a required command whose definition differs from the trusted baseline", async () => {
  const root = await project();
  const config = await loadConfig(root);
  const baseline = await loadPolicyBaseline(root);
  expect(baseline).not.toBeNull();
  baseline!.commands = config.commands.map((command) => ({
    ...command,
    args: [...command.args],
  }));
  baseline!.requiredCommands = config.commands.map((command) => command.name);
  config.commands[0]!.args = ["-e", "process.exit(0)"];

  expect(policyDiagnostics(config, baseline!)).toContainEqual(
    expect.objectContaining({
      code: "POLICY_COMMAND_DEFINITION",
      path: "test",
    }),
  );
});
