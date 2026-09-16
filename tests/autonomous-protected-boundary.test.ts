import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  computeProtectedSet,
  FileRunStore,
  HohOrchestrator,
  parseHohConfig,
  type HohServices,
} from "../packages/analysis/src/hoh.js";
import { fixture } from "./helpers.js";

describe("protected-set role boundaries", () => {
  /** @id TEST-AUTONOMOUS-PROTECTED-BOUNDARY-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-013
   */
  it("TEST-AUTONOMOUS-PROTECTED-BOUNDARY-001 stops before Planner on an unapproved digest mismatch", async () => {
    const root = await fixture({
      "baseline-specs/legacy.md": "approved\n",
      ".musubix/compatibility/command-collisions.json":
        '{"schemaVersion":1,"entries":[]}',
    });
    const protectedSet = await computeProtectedSet(root, []);
    const store = new FileRunStore(root);
    const run = await store.create({
      source: { kind: "prompt", text: "Build safely" },
      config: parseHohConfig({
        model: "gpt-5.4",
        budget: { aiCredits: 10 },
        commands: { test: ["npm", "test"] },
      }),
      protectedSet,
    });
    await writeFile(resolve(root, "baseline-specs/legacy.md"), "tampered\n");
    const planner = vi.fn();
    const services: HohServices = {
      roles: {
        planner,
        developer: vi.fn(),
        qa: vi.fn(),
      },
      project: {
        preflight: vi.fn(),
        candidateChecks: vi.fn(),
      },
      git: {
        snapshot: vi.fn(),
        treeDigest: vi.fn(),
        rollback: vi.fn(),
      },
    };

    expect(
      await new HohOrchestrator(store, services).resume(run.id),
    ).toMatchObject({
      state: "failed",
      terminalReason: "protected-set-mismatch",
    });
    expect(planner).not.toHaveBeenCalled();
  });
});
