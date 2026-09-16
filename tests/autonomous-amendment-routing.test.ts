import { describe, expect, it, vi } from "vitest";
import {
  CommandInventoryError,
  FileRunStore,
  HohOrchestrator,
  parseHohConfig,
  type HohServices,
} from "../packages/analysis/src/hoh.js";
import { fixture } from "./helpers.js";

describe("static inventory routing", () => {
  /** @id TEST-AUTONOMOUS-AMENDMENT-ROUTING-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-011
   */
  it("TEST-AUTONOMOUS-AMENDMENT-ROUTING-001 pauses before QA and claim assignment", async () => {
    const root = await fixture();
    const store = new FileRunStore(root);
    const created = await store.create({
      source: { kind: "prompt", text: "Build safely" },
      config: parseHohConfig({
        model: "gpt-5.4",
        budget: { aiCredits: 10 },
        commands: { test: ["npm", "test"] },
      }),
      requirements: ["REQ-AUTONOMOUS-DEVELOPMENT-011"],
    });
    const planned = await store.transition(created.id, "planned", "test-plan");
    planned.iteration = 1;
    await store.save(planned);
    const candidateChecks = vi.fn();
    const qa = vi.fn();
    const services: HohServices = {
      roles: {
        planner: vi.fn(),
        developer: vi.fn().mockResolvedValue({
          executionRecords: [{ command: "test", exitCode: 0 }],
        }),
        qa,
      },
      project: {
        preflight: vi.fn(),
        staticCandidateValidation: vi.fn().mockRejectedValue(
          new CommandInventoryError(
            "COMMAND_INVENTORY_MISSING_PATH",
            "Missing candidate path",
            ["musubix4 protected-set"],
          ),
        ),
        candidateChecks,
      },
      git: {
        snapshot: vi.fn().mockResolvedValue({
          ref: "refs/musubix4/runs/test/stages/candidate",
          treeDigest: "a".repeat(40),
        }),
        treeDigest: vi.fn(),
        rollback: vi.fn(),
      },
    };

    expect(
      await new HohOrchestrator(store, services).resume(created.id),
    ).toMatchObject({
      state: "amendment-required",
      amendmentEpisodeCount: 1,
      offendingInventoryPaths: ["musubix4 protected-set"],
      evidence: { verified: 0, unresolved: 0, regressions: 0 },
    });
    expect(candidateChecks).not.toHaveBeenCalled();
    expect(qa).not.toHaveBeenCalled();
  });
});
