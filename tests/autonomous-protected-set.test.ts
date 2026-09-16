import { describe, expect, it } from "vitest";
import * as hoh from "../packages/analysis/src/hoh.js";
import { fixture } from "./helpers.js";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

describe("protected-set identity", () => {
  /** @id TEST-AUTONOMOUS-PROTECTED-SET-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-013 REQ-AUTONOMOUS-DEVELOPMENT-018
   */
  it("TEST-AUTONOMOUS-PROTECTED-SET-001 binds every baseline file and the collision inventory", async () => {
    const root = await fixture({
      "baseline-specs/features/legacy/requirements.md": "## REQ-LEGACY-001\n",
      "baseline-specs/oracle/golden.json": '{"valid":true}',
      ".musubix/compatibility/command-collisions.json":
        '{"schemaVersion":1,"entries":[]}',
      "tests/inherited.test.ts": "export const inherited = true;\n",
    });
    const computeProtectedSet = (
      hoh as typeof hoh & {
        computeProtectedSet?: (
          root: string,
          manifestEnumeratedPaths: string[],
        ) => Promise<{ paths: string[]; digest: string }>;
      }
    ).computeProtectedSet;

    expect(computeProtectedSet).toBeTypeOf("function");
    const first = await computeProtectedSet!(root, [
      "tests/inherited.test.ts",
    ]);
    expect(first.paths).toEqual([
      ".musubix/compatibility/command-collisions.json",
      "baseline-specs/features/legacy/requirements.md",
      "baseline-specs/oracle/golden.json",
      "tests/inherited.test.ts",
    ]);

    await writeFile(
      resolve(root, ".musubix/compatibility/command-collisions.json"),
      '{"schemaVersion":1,"entries":[{"path":"musubix4 run"}]}',
    );
    expect(
      (await computeProtectedSet!(root, ["tests/inherited.test.ts"])).digest,
    ).not.toBe(first.digest);

    await expect(
      computeProtectedSet!(root, ["tests/missing.test.ts"]),
    ).rejects.toMatchObject({
      code: "PROTECTED_SET_PATH_MISSING",
      path: "tests/missing.test.ts",
    });
  });
});
