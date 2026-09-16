import { describe, expect, it, vi } from "vitest";
import {
  FileRunStore,
  HohOrchestrator,
  parseHohConfig,
  type HohServices,
  type MandatoryQaCheck,
} from "../packages/analysis/src/hoh.js";
import { fixture } from "./helpers.js";

describe("seven-check QA orchestration", () => {
  /** @id TEST-AUTONOMOUS-QA-ORCHESTRATION-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-008 REQ-AUTONOMOUS-DEVELOPMENT-010
   */
  it("TEST-AUTONOMOUS-QA-ORCHESTRATION-001 uses fresh mandatory checks as readiness authority", async () => {
    const root = await fixture();
    const store = new FileRunStore(root);
    const created = await store.create({
      source: { kind: "prompt", text: "Build safely" },
      config: parseHohConfig({
        model: "gpt-5.4",
        budget: { aiCredits: 10 },
        commands: { test: ["npm", "test"] },
      }),
      requirements: ["REQ-AUTONOMOUS-DEVELOPMENT-008"],
    });
    const candidate = {
      ref: "refs/musubix4/runs/test/stages/candidate",
      treeDigest: "a".repeat(40),
    };
    const current = await store.transition(
      created.id,
      "candidate",
      "test-candidate",
    );
    current.candidate = candidate;
    current.iteration = 1;
    await store.save(current);
    const checks: MandatoryQaCheck[] = [
      "build",
      "focused-test",
      "static-validation",
      "trace",
      "dependency-cycle",
      "structured-contract",
      "inherited-compatibility",
    ].map((id) => ({
      id: id as MandatoryQaCheck["id"],
      status: "passed",
      evidence: [`evidence://${id}`],
    }));
    const mandatoryChecks = vi.fn().mockResolvedValue(checks);
    const qa = vi.fn().mockResolvedValue({
      summary: "Role prose cannot authorize readiness.",
    });
    const services: HohServices = {
      roles: {
        planner: vi.fn(),
        developer: vi.fn(),
        qa,
      },
      project: {
        preflight: vi.fn(),
        candidateChecks: vi.fn(),
        mandatoryChecks,
      },
      git: {
        snapshot: vi.fn(),
        treeDigest: vi.fn().mockResolvedValue(candidate.treeDigest),
        rollback: vi.fn(),
        createQaWorkspace: vi.fn().mockResolvedValue({
          path: root,
          candidate,
        }),
        cleanupQaWorkspace: vi.fn(),
      },
    };

    const result = await new HohOrchestrator(store, services).resume(
      created.id,
    );
    expect(mandatoryChecks).toHaveBeenCalledTimes(1);
    expect(qa).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      state: "approval-paused",
      evidence: { verified: 7, unresolved: 0, regressions: 0 },
      approval: { stage: "release" },
    });
  });
});
