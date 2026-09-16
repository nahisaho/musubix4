import { describe, expect, it } from "vitest";
import { extractDeclaredCommandSurface } from "../packages/analysis/src/hoh.js";
import { fixture } from "./helpers.js";

describe("literal-loop command surface", () => {
  /** @id TEST-AUTONOMOUS-SURFACE-LOOP-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-001 REQ-AUTONOMOUS-DEVELOPMENT-011
   */
  it("TEST-AUTONOMOUS-SURFACE-LOOP-001 deterministically expands literal command arrays", async () => {
    const root = await fixture({
      "src/cli.ts": `
        import { Command } from "commander";
        export function createProgram(): Command {
          const program = new Command().name("musubix4");
          const tdd = program.command("tdd");
          for (const phase of ["red", "green", "refactor"] as const) {
            tdd.command(\`\${phase} <test-id>\`).option("--json");
          }
          return program;
        }
      `,
    });

    expect(
      (await extractDeclaredCommandSurface(root, "src/cli.ts")).commands,
    ).toEqual([
      { path: "musubix4", options: [] },
      { path: "musubix4 tdd", options: [] },
      { path: "musubix4 tdd green", options: ["--json"] },
      { path: "musubix4 tdd red", options: ["--json"] },
      { path: "musubix4 tdd refactor", options: ["--json"] },
    ]);
  });
});
