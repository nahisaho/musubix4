import { describe, expect, it } from "vitest";
import * as hoh from "../packages/analysis/src/hoh.js";
import { fixture } from "./helpers.js";

describe("static command surface", () => {
  /** @id TEST-AUTONOMOUS-SURFACE-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-001 REQ-AUTONOMOUS-DEVELOPMENT-011 REQ-AUTONOMOUS-DEVELOPMENT-013
   */
  it("TEST-AUTONOMOUS-SURFACE-001 extracts literal Commander registrations without executing candidate code", async () => {
    const root = await fixture({
      "src/cli.ts": `
        import { Command } from "commander";
        const program = new Command().name("musubix4");
        const workflow = program.command("workflow");
        workflow.command("status").option("--json");
        program.command("trace").option("--strict").option("--json");
        throw new Error("candidate code must not execute");
      `,
      "src/dynamic.ts": `
        import { Command } from "commander";
        const program = new Command().name("musubix4");
        const suffix = process.env.COMMAND_SUFFIX;
        program.command("run-" + suffix);
      `,
    });
    const extractDeclaredCommandSurface = (
      hoh as typeof hoh & {
        extractDeclaredCommandSurface?: (
          root: string,
          entryPath: string,
        ) => Promise<{
          commands: Array<{ path: string; options: string[] }>;
          digest: string;
        }>;
      }
    ).extractDeclaredCommandSurface;

    expect(extractDeclaredCommandSurface).toBeTypeOf("function");
    const surface = await extractDeclaredCommandSurface!(root, "src/cli.ts");
    expect(surface.commands).toEqual([
      { path: "musubix4", options: [] },
      { path: "musubix4 trace", options: ["--json", "--strict"] },
      { path: "musubix4 workflow", options: [] },
      { path: "musubix4 workflow status", options: ["--json"] },
    ]);
    expect(surface.digest).toMatch(/^[a-f0-9]{64}$/);

    await expect(
      extractDeclaredCommandSurface!(root, "src/dynamic.ts"),
    ).rejects.toMatchObject({
      code: "UNEXTRACTABLE_COMMAND_REGISTRATION",
      path: "src/dynamic.ts",
    });
  });
});
