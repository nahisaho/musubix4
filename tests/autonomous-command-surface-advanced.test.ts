import { describe, expect, it } from "vitest";
import { extractDeclaredCommandSurface } from "../packages/analysis/src/hoh.js";
import { fixture } from "./helpers.js";

describe("advanced static command surface", () => {
  /** @id TEST-AUTONOMOUS-SURFACE-ADVANCED-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-001 REQ-AUTONOMOUS-DEVELOPMENT-011
   */
  it("TEST-AUTONOMOUS-SURFACE-ADVANCED-001 extracts function-local registrations and shared literal wrappers", async () => {
    const root = await fixture({
      "src/cli.ts": `
        import { Command } from "commander";
        function common(command: Command): Command {
          return command
            .option("--root <directory>")
            .option("--json");
        }
        export function createProgram(): Command {
          const program = new Command().name("musubix4");
          common(program.command("run"))
            .option("--prompt <text>");
          const workflow = program.command("workflow");
          workflow.command("status");
          return program;
        }
      `,
    });

    expect(
      await extractDeclaredCommandSurface(root, "src/cli.ts"),
    ).toEqual({
      schemaVersion: 1,
      commands: [
        { path: "musubix4", options: [] },
        {
          path: "musubix4 run",
          options: ["--json", "--prompt", "--root"],
        },
        { path: "musubix4 workflow", options: [] },
        { path: "musubix4 workflow status", options: [] },
      ],
      digest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });
});
