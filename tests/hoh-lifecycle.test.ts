import {
  chmod,
  lstat,
  readFile,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createProgram } from "../packages/cli/src/main.js";
import {
  FileRunStore,
  HohOrchestrator,
  assessCandidate,
  deriveClaimMatrix,
  derivePolicy,
  materializeSpecification,
  normalizeQa,
  parseHohConfig,
  validatePlannerOutput,
  type CandidateSnapshot,
  type HohServices,
  type PublicSpecification,
  type RunRecord,
} from "../packages/analysis/src/hoh.js";
import { fixture } from "./helpers.js";
describe("HoH configuration and policy", () => {
  /** @id TEST-HOH-CONFIG-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-002 REQ-AUTONOMOUS-DEVELOPMENT-004 REQ-AUTONOMOUS-DEVELOPMENT-010 REQ-AUTONOMOUS-DEVELOPMENT-012 REQ-AUTONOMOUS-DEVELOPMENT-015
   */
  it("TEST-HOH-CONFIG-001 validates optional strict HoH configuration and defaults", () => {
    const config = parseHohConfig({
      model: "gpt-5.4",
      budget: { aiCredits: 10 },
      commands: { build: ["npm", "run", "build"], test: ["npm", "test"] },
    });

    expect(config.limits).toMatchObject({
      maxIterations: 30,
      maxActiveHours: 24,
      stagnantIterations: 3,
      roleOutputRetryLimit: 2,
      blockerRepairRetryLimit: 2,
    });
    expect(config.maxSpecificationBytes).toBe(1_048_576);
    expect(() =>
      parseHohConfig({
        model: "gpt-5.4",
        budget: { aiCredits: 0 },
        commands: { build: ["npm", "run", "build"] },
      }),
    ).toThrow(/positive/);
    expect(() =>
      parseHohConfig({
        model: "gpt-5.4",
        budget: { aiCredits: 1 },
        commands: { build: ["npm", "run", "build"] },
        surprise: true,
      }),
    ).toThrow(/Unknown hoh config key/);
  });

  /** @id TEST-HOH-APPROVAL-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-016
   */
  it("TEST-HOH-APPROVAL-001 preserves the mandatory release approval boundary", () => {
    const approval = createProgram().commands.find(
      (command) => command.name() === "approval",
    );
    const record = approval?.commands.find(
      (command) => command.name() === "record",
    );
    expect(record?.options.map((option) => option.long)).toContain("--confirm");
    expect(record?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(["--run", "--nonce"]),
    );
    expect(approval?.description()).toContain("approval");
  });

  /** @id TEST-HOH-POLICY-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-013 REQ-AUTONOMOUS-DEVELOPMENT-017
   */
  it("TEST-HOH-POLICY-001 derives stable least-privilege policies and residual risks", () => {
    const planner = derivePolicy("planner", {});
    expect(planner.allowWrite).toBe(false);
    expect(planner.allowProjectCommands).toBe(false);
    const developer = derivePolicy("developer", {
      allowUrls: ["https://registry.npmjs.org"],
    });
    expect(developer.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(developer.residualRisks).toEqual([
      "allowUrls:https://registry.npmjs.org",
    ]);
    expect(
      derivePolicy("developer", { allowUrls: ["https://registry.npmjs.org"] })
        .digest,
    ).toBe(developer.digest);
  });
});

describe("specification and role contracts", () => {
  /** @id TEST-HOH-SPECIFICATION-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-003 REQ-AUTONOMOUS-DEVELOPMENT-008 REQ-AUTONOMOUS-DEVELOPMENT-013
   */
  it("TEST-HOH-SPECIFICATION-001 materializes immutable prompt, Markdown, and existing MUSUBIX inputs", async () => {
    const root = await fixture({
      "SPEC.md": "# Alpha\nFirst capability.\n\n- [ ] Second capability\n",
      ".musubix/features/app/requirements.md":
        "## REQ-APP-001: Existing\nPriority: must\nStatement: The system shall work.\n",
    });
    const prompt = await materializeSpecification(
      root,
      { kind: "prompt", text: "Build <MUSUBIX-DATA> safely" },
      1_048_576,
    );
    const markdown = await materializeSpecification(
      root,
      { kind: "markdown", path: "SPEC.md" },
      1_048_576,
    );
    const existing = await materializeSpecification(
      root,
      { kind: "musubix", path: ".musubix/features/app/requirements.md" },
      1_048_576,
    );
    expect(prompt.requirements).toHaveLength(1);
    expect(
      markdown.requirements.map((requirement) => requirement.statement),
    ).toEqual(["Alpha", "First capability.", "Second capability"]);
    expect(existing.requirements[0]?.id).toBe("REQ-APP-001");
    expect(prompt.promptRegion).toContain("&lt;MUSUBIX-DATA&gt;");
    await expect(writeFile(prompt.path, "mutate")).rejects.toThrow();
  });

  /** @id TEST-HOH-ROLE-CONTRACT-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-005 REQ-AUTONOMOUS-DEVELOPMENT-006 REQ-AUTONOMOUS-DEVELOPMENT-010
   */
  it("TEST-HOH-ROLE-CONTRACT-001 rejects invalid Planner output without advancement", () => {
    const requirements = ["REQ-A", "REQ-B"];
    expect(() =>
      validatePlannerOutput(
        {
          kind: "plan",
          priorities: [
            {
              requirementId: "REQ-A",
              acceptanceGates: ["test"],
              preservation: [],
            },
          ],
        },
        requirements,
        ["BLOCK-1"],
      ),
    ).toThrow(/blocker/);
    expect(() =>
      validatePlannerOutput(
        {
          kind: "plan",
          priorities: [
            {
              requirementId: "REQ-A",
              acceptanceGates: ["a"],
              preservation: ["existing"],
            },
            {
              requirementId: "REQ-B",
              acceptanceGates: ["b"],
              preservation: ["existing"],
            },
            {
              requirementId: "REQ-A",
              acceptanceGates: ["c"],
              preservation: ["existing"],
            },
            {
              requirementId: "REQ-B",
              acceptanceGates: ["d"],
              preservation: ["existing"],
            },
          ],
          addressedBlockers: ["BLOCK-1"],
        },
        requirements,
        ["BLOCK-1"],
      ),
    ).toThrow(/three/);
  });
});

describe("evidence and durable lifecycle", () => {
  /** @id TEST-HOH-LIFECYCLE-003
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-004 REQ-AUTONOMOUS-DEVELOPMENT-011 REQ-AUTONOMOUS-DEVELOPMENT-012 REQ-AUTONOMOUS-DEVELOPMENT-018
   */
  it("TEST-HOH-LIFECYCLE-003 durably accounts attempts, recovers interruption, and applies exact stop precedence", async () => {
    const root = await fixture();
    const store = new FileRunStore(root);
    const run = await store.create({
      source: { kind: "prompt", text: "A" },
      config: parseHohConfig({
        model: "gpt-fixed",
        budget: { aiCredits: 10 },
        commands: { test: ["npm", "test"] },
        limits: { maxIterations: 2, maxActiveHours: 1, stagnantIterations: 2 },
      }),
    });
    const first = await store.reserveAttemptBudget(run.id, "planner", 4);
    await store.settleAttemptBudget(run.id, first, 1.5);
    const interrupted = await store.reserveAttemptBudget(
      run.id,
      "developer",
      3,
    );
    const module = (await import("../packages/analysis/src/hoh.js")) as Record<
      string,
      unknown
    >;
    const recover = module.recoverInterruptedRun as
      | ((
          store: FileRunStore,
          runId: string,
          activeStepMs?: number,
        ) => Promise<RunRecord>)
      | undefined;
    const stopReason = module.determineStopReason as
      ((input: Record<string, unknown>) => string | undefined) | undefined;
    expect(recover).toBeTypeOf("function");
    expect(stopReason).toBeTypeOf("function");
    const recovered = await recover!(store, run.id, 2_000);
    expect(recovered.usage).toEqual({ aiCredits: 4.5, reserved: 0 });
    expect(recovered.activeDurationMs).toBe(2_000);
    expect(
      recovered.attempts?.find((attempt) => attempt.id === interrupted)?.status,
    ).toBe("abandoned");
    await recover!(store, run.id, 2_000);
    expect((await store.status(run.id)).usage.aiCredits).toBe(4.5);
    expect(
      stopReason!({
        readiness: true,
        releaseRejected: true,
        cancellationRequested: true,
        iteration: 2,
        maxIterations: 2,
        activeDurationMs: 3_600_000,
        maxActiveDurationMs: 3_600_000,
        usedCredits: 10,
        budgetCredits: 10,
        stagnantIterations: 2,
        maxStagnantIterations: 2,
        unrecoverableFailure: true,
      }),
    ).toBe("readiness");
    expect(
      stopReason!({ releaseRejected: true, cancellationRequested: true }),
    ).toBe("release-rejected");
    expect(
      stopReason!({
        cancellationRequested: true,
        iteration: 2,
        maxIterations: 2,
      }),
    ).toBe("cancelled");
    expect(
      stopReason!({
        iteration: 2,
        maxIterations: 2,
        activeDurationMs: 3_600_000,
        maxActiveDurationMs: 3_600_000,
      }),
    ).toBe("iteration-limit");
    expect(
      stopReason!({
        activeDurationMs: 3_600_000,
        maxActiveDurationMs: 3_600_000,
        usedCredits: 10,
        budgetCredits: 10,
      }),
    ).toBe("time-limit");
    expect(
      stopReason!({
        usedCredits: 10,
        budgetCredits: 10,
        stagnantIterations: 2,
        maxStagnantIterations: 2,
      }),
    ).toBe("budget-exhausted");
    expect(
      stopReason!({
        stagnantIterations: 2,
        maxStagnantIterations: 2,
        unrecoverableFailure: true,
      }),
    ).toBe("stagnation-limit");
    expect(stopReason!({ unrecoverableFailure: true })).toBe(
      "unrecoverable-failure",
    );
  });

  /** @id TEST-HOH-INVALID-OUTPUT-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-010
   */
  it("TEST-HOH-INVALID-OUTPUT-001 retries invalid role output and advances exactly once", async () => {
    const root = await fixture();
    const store = new FileRunStore(root);
    let attempts = 0;
    const services: HohServices = {
      roles: {
        planner: async (context) => {
          attempts += 1;
          if (attempts === 1) return { kind: "invalid" };
          const [requirementId] = (context as { requirements: string[] })
            .requirements;
          return {
            kind: "plan",
            priorities: [
              {
                requirementId: requirementId!,
                acceptanceGates: ["test"],
                preservation: ["base"],
              },
            ],
            addressedBlockers: [],
          };
        },
        developer: async () => {
          throw new Error("not reached");
        },
        qa: async () => {
          throw new Error("not reached");
        },
      },
      project: {
        preflight: async () => undefined,
        candidateChecks: async () => true,
      },
      git: {
        snapshot: async () => ({ ref: "unused", treeDigest: "unused" }),
        treeDigest: async () => "unused",
        rollback: async () => undefined,
      },
    };
    const run = await new HohOrchestrator(store, services).start({
      source: { kind: "prompt", text: "Requirement A" },
      config: parseHohConfig({
        model: "gpt-5.4",
        budget: { aiCredits: 10 },
        commands: { test: ["npm", "test"] },
      }),
    });
    const status = await new HohOrchestrator(store, services).resume(run.id);
    expect(attempts).toBe(2);
    expect(status.state).toBe("planned");
    expect(
      status.journal.filter((entry) => entry.event === "planner-completed"),
    ).toHaveLength(1);
  });

  /** @id TEST-HOH-EVIDENCE-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-008 REQ-AUTONOMOUS-DEVELOPMENT-009 REQ-AUTONOMOUS-DEVELOPMENT-012 REQ-AUTONOMOUS-DEVELOPMENT-018
   */
  it("TEST-HOH-EVIDENCE-001 normalizes seven dimensions and detects readiness and regression", () => {
    const matrix = deriveClaimMatrix(["REQ-A"]);
    expect(matrix).toHaveLength(7);
    const verified = normalizeQa(
      matrix.map((claim) => ({
        claimId: claim.id,
        status: "verified" as const,
        evidence: [`command:${claim.dimension}`],
      })),
      matrix,
    );
    expect(verified.readiness).toBe(true);
    const regressed = normalizeQa(
      matrix.map((claim, index) => ({
        claimId: claim.id,
        status: index === 0 ? ("gap" as const) : ("verified" as const),
        evidence: [`command:${claim.dimension}`],
      })),
      matrix,
    );
    expect(assessCandidate(verified, regressed, true)).toMatchObject({
      preservationVerified: false,
      improved: false,
      regressions: [matrix[0]!.id],
    });
  });

  describe("iteration 2 harness adapters", () => {
    /** @id TEST-HOH-COPILOT-ADAPTER-002
     * @verifies REQ-AUTONOMOUS-DEVELOPMENT-004 REQ-AUTONOMOUS-DEVELOPMENT-010 REQ-AUTONOMOUS-DEVELOPMENT-013 REQ-AUTONOMOUS-DEVELOPMENT-014
     */
    it("TEST-HOH-COPILOT-ADAPTER-002 invokes a fixed non-interactive Copilot contract and retries invalid JSON", async () => {
      const root = await fixture();
      const executable = resolve(root, "fake-copilot.mjs");
      await writeFile(
        executable,
        `#!/usr/bin/env node
  import fs from 'node:fs';
  if (process.argv.includes('--version')) { console.log('1.2.3'); process.exit(0); }
  const state = process.env.FAKE_STATE;
  const count = Number(fs.existsSync(state) ? fs.readFileSync(state, 'utf8') : '0') + 1;
  fs.writeFileSync(state, String(count));
  console.log(JSON.stringify({type:'usage',aiCredits:0.25,model:'gpt-fixed',reasoning:'high',version:'1.2.3'}));
  console.log(JSON.stringify({type:'result',result:count === 1 ? {kind:'invalid'} : {kind:'plan',priorities:[{requirementId:'REQ-A',acceptanceGates:['test'],preservation:['base']}],addressedBlockers:[]}}));
  `,
      );
      await chmod(executable, 0o755);
      const module =
        (await import("../packages/analysis/src/hoh.js")) as Record<
          string,
          unknown
        >;
      const invoke = module.invokeCopilotRole as
        | ((input: Record<string, unknown>) => Promise<Record<string, unknown>>)
        | undefined;
      expect(invoke).toBeTypeOf("function");
      const result = await invoke!({
        executable,
        cwd: root,
        role: "planner",
        prompt: "secret=TOP-SECRET",
        config: parseHohConfig({
          model: "gpt-fixed",
          reasoning: "high",
          copilotCliVersion: "1.2.3",
          budget: { aiCredits: 2 },
          commands: { test: ["npm", "test"] },
        }),
        policy: derivePolicy("planner", { allowSecrets: ["SECRET_TOKEN"] }),
        environment: {
          SECRET_TOKEN: "TOP-SECRET",
          FAKE_STATE: resolve(root, "attempts.txt"),
        },
        validate: (value: unknown) =>
          validatePlannerOutput(value, ["REQ-A"], []),
      });
      expect(result).toMatchObject({ attempts: 2, usage: { aiCredits: 0.5 } });
      expect(JSON.stringify(result)).not.toContain("TOP-SECRET");
      await expect(
        invoke!({
          executable,
          cwd: root,
          role: "planner",
          prompt: "x",
          config: parseHohConfig({
            model: "gpt-fixed",
            reasoning: "high",
            copilotCliVersion: "9.9.9",
            budget: { aiCredits: 1 },
            commands: { test: ["npm", "test"] },
          }),
          policy: derivePolicy("planner", {}),
          environment: { FAKE_STATE: resolve(root, "drift.txt") },
          validate: (value: unknown) => value,
        }),
      ).rejects.toThrow(/version drift/i);
    });

    /** @id TEST-HOH-COPILOT-ADAPTER-003
     * @verifies REQ-AUTONOMOUS-DEVELOPMENT-004 REQ-AUTONOMOUS-DEVELOPMENT-010 REQ-AUTONOMOUS-DEVELOPMENT-013 REQ-AUTONOMOUS-DEVELOPMENT-014
     */
    it("TEST-HOH-COPILOT-ADAPTER-003 parses diverse real-shaped JSONL deterministically and settles or abandons once", async () => {
      const root = await fixture();
      const executable = resolve(root, "fake-copilot-diverse.mjs");
      await writeFile(
        executable,
        `#!/usr/bin/env node
import fs from 'node:fs';
if (process.argv.includes('--version')) {
  console.log('GitHub Copilot CLI 1.2.3');
  process.exit(0);
}
const scenario = process.env.SCENARIO;
console.log(JSON.stringify({type:'progress',message:'working SECRET'}));
console.log(JSON.stringify({type:'tool',tool:{name:'read_file'}}));
console.log(JSON.stringify({type:'diagnostic',level:'info',message:'safe'}));
if (scenario === 'valid') {
  console.log(JSON.stringify({type:'usage',aiCredits:0.2,model:'gpt-fixed',version:'1.2.3'}));
  console.log(JSON.stringify({type:'usage',aiCredits:0.3,model:'gpt-fixed',version:'1.2.3'}));
  console.log(JSON.stringify({type:'result',result:{kind:'plan',priorities:[{requirementId:'REQ-A',acceptanceGates:['test'],preservation:['base']}],addressedBlockers:[]}}));
} else if (scenario === 'ambiguous') {
  console.log(JSON.stringify({type:'result',result:{kind:'plan'}}));
  console.log(JSON.stringify({type:'result',result:{kind:'readiness'}}));
} else if (scenario === 'absent-usage') {
  console.log(JSON.stringify({type:'result',result:{kind:'plan'}}));
} else {
  process.stdout.write('{"type":"result"');
}
`,
      );
      await chmod(executable, 0o755);
      const module =
        (await import("../packages/analysis/src/hoh.js")) as Record<
          string,
          unknown
        >;
      const invoke = module.invokeCopilotRole as (
        input: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>;
      const lifecycle: string[] = [];
      const common = {
        executable,
        cwd: root,
        role: "planner",
        prompt: "SECRET",
        config: parseHohConfig({
          model: "gpt-fixed",
          copilotCliVersion: "1.2.3",
          budget: { aiCredits: 1 },
          commands: { test: ["npm", "test"] },
          limits: { roleOutputRetryLimit: 1 },
        }),
        policy: derivePolicy("planner", { allowSecrets: ["TOKEN"] }),
        reserveAttempt: async () => {
          lifecycle.push("reserve");
          return `r-${lifecycle.length}`;
        },
        settleAttempt: async (_id: string, usage: number) => {
          lifecycle.push(`settle:${usage}`);
        },
        abandonAttempt: async () => {
          lifecycle.push("abandon");
        },
      };
      const result = await invoke({
        ...common,
        environment: { TOKEN: "SECRET", SCENARIO: "valid" },
        validate: (value: unknown) =>
          validatePlannerOutput(value, ["REQ-A"], []),
      });
      expect(result).toMatchObject({
        attempts: 1,
        usage: { aiCredits: 0.5 },
      });
      expect(result.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "progress" }),
          expect.objectContaining({ type: "tool" }),
          expect.objectContaining({ type: "diagnostic" }),
        ]),
      );
      expect(JSON.stringify(result)).not.toContain("SECRET");
      expect(lifecycle).toEqual(["reserve", "settle:0.5"]);
      for (const scenario of ["ambiguous", "absent-usage", "malformed"]) {
        lifecycle.length = 0;
        await expect(
          invoke({
            ...common,
            environment: { TOKEN: "SECRET", SCENARIO: scenario },
            validate: (value: unknown) => value,
          }),
        ).rejects.toThrow(/retries exhausted|ambiguous|usage|malformed/i);
        expect(lifecycle.filter((event) => event === "reserve")).toHaveLength(
          2,
        );
        expect(lifecycle.filter((event) => event === "abandon")).toHaveLength(
          2,
        );
      }
    });

    /** @id TEST-HOH-COPILOT-ADAPTER-004
     * @verifies REQ-AUTONOMOUS-DEVELOPMENT-004
     */
    it("TEST-HOH-COPILOT-ADAPTER-004 parses current Copilot role JSONL semantic anchors", async () => {
      const root = await fixture();
      const executable = resolve(root, "fake-copilot-current.mjs");
      const fixturePath = resolve(
        process.cwd(),
        "tests/fixtures/copilot-cli-1.0.86-role-output.jsonl",
      );
      await writeFile(
        executable,
        `#!/usr/bin/env node
import { readFileSync } from 'node:fs';
if (process.argv.includes('--version')) {
  console.error(process.env.SECRET_TOKEN ?? '');
  console.log('GitHub Copilot CLI 1.0.86-2');
  process.exit(0);
}
const events = readFileSync(process.env.COPILOT_PROTOCOL_FIXTURE, 'utf8')
  .trim().split('\\n').map((line) => JSON.parse(line));
const scenario = process.env.SCENARIO;
if (scenario === 'decreasing') {
  events.splice(events.length - 1, 0, {
    type: 'session.usage_checkpoint',
    timestamp: '2026-01-01T00:00:00.011Z',
    data: { totalNanoAiu: 1000000000 },
  });
}
if (scenario === 'model-drift') {
  events.find((event) => event.type === 'assistant.message').data.model = 'other-model';
}
if (scenario === 'unknown') {
  events.splice(events.length - 1, 0, {
    type: 'future.lifecycle_event',
    timestamp: '2026-01-01T00:00:00.011Z',
    data: { ignored: true },
  });
}
for (const event of events) console.log(JSON.stringify(event));
`,
      );
      await chmod(executable, 0o755);
      const module =
        (await import("../packages/analysis/src/hoh.js")) as Record<
          string,
          unknown
        >;
      const invoke = module.invokeCopilotRole as (
        input: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>;
      const lifecycle: string[] = [];
      const common = {
        executable,
        cwd: root,
        role: "planner",
        prompt: "current protocol",
        config: parseHohConfig({
          model: "gpt-5.3-codex",
          copilotCliVersion: "1.0.86-2",
          budget: { aiCredits: 10 },
          commands: { test: ["npm", "test"] },
          limits: { roleOutputRetryLimit: 1 },
        }),
        policy: derivePolicy("planner", { allowSecrets: ["SECRET_TOKEN"] }),
        reserveAttempt: async () => {
          lifecycle.push("reserve");
          return "reservation";
        },
        settleAttempt: async (_id: string, usage: number) => {
          lifecycle.push(`settle:${usage}`);
        },
        abandonAttempt: async () => {
          lifecycle.push("abandon");
        },
      };
      const result = await invoke({
        ...common,
        environment: {
          COPILOT_PROTOCOL_FIXTURE: fixturePath,
          SCENARIO: "unknown",
          SECRET_TOKEN: "PROBE-SECRET",
        },
        validate: (value: unknown) => value,
      });
      expect(result).toMatchObject({
        attempts: 1,
        usage: { aiCredits: 5.782875 },
        value: {
          kind: "plan",
          priorities: [],
          addressedBlockers: [],
        },
      });
      expect(result.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "session.mcp_server_status_changed" }),
          expect.objectContaining({ type: "future.lifecycle_event" }),
          expect.objectContaining({ type: "session.usage_checkpoint" }),
        ]),
      );
      expect(result.records).toEqual([
        expect.objectContaining({ argv: [executable, "--version"] }),
        expect.objectContaining({ argv: expect.arrayContaining([executable]) }),
      ]);
      expect(JSON.stringify(result.records)).not.toContain("PROBE-SECRET");
      expect(lifecycle).toEqual(["reserve", "settle:5.782875"]);

      for (const scenario of ["decreasing", "model-drift"]) {
        lifecycle.length = 0;
        await expect(
          invoke({
            ...common,
            environment: {
              COPILOT_PROTOCOL_FIXTURE: fixturePath,
              SCENARIO: scenario,
              SECRET_TOKEN: "PROBE-SECRET",
            },
            validate: (value: unknown) => value,
          }),
        ).rejects.toThrow(/retries exhausted|usage|model/i);
        expect(lifecycle).toEqual([
          "reserve",
          "abandon",
          "reserve",
          "abandon",
        ]);
      }
    });

    /** @id TEST-HOH-COPILOT-ADAPTER-006
     * @verifies REQ-AUTONOMOUS-DEVELOPMENT-004
     */
    it("TEST-HOH-COPILOT-ADAPTER-006 accepts only raw JSON or one exact JSON fence", async () => {
      const root = await fixture();
      const executable = resolve(root, "fake-copilot-fence.mjs");
      await writeFile(
        executable,
        `#!/usr/bin/env node
import fs from 'node:fs';
const fence = String.fromCharCode(96).repeat(3);
const longFence = String.fromCharCode(96).repeat(4);
if (process.argv.includes('--version')) {
  fs.writeFileSync(process.env.VERSION_SENTINEL, 'probed');
  console.log('GitHub Copilot CLI 1.2.3');
  process.exit(0);
}
if (!fs.existsSync(process.env.VERSION_SENTINEL)) process.exit(3);
const outputs = {
  raw: '  ' + JSON.stringify({kind:'plan',message:'literal ' + fence + 'json fence'}) + '  ',
  fenced: '\\n\\t' + fence + 'json\\r\\n{"kind":"plan"}\\r\\n' + fence + '\\n',
  prose: 'Result:\\n' + fence + 'json\\n{"kind":"plan"}\\n' + fence,
  multiple: fence + 'json\\n{"kind":"plan"}\\n' + fence + '\\n' + fence + 'json\\n{}\\n' + fence,
  incomplete: fence + 'json\\n{"kind":"plan"}',
  uppercase: fence + 'JSON\\n{"kind":"plan"}\\n' + fence,
  padded: fence + 'json \\n{"kind":"plan"}\\n' + fence,
  long: longFence + 'json\\n{"kind":"plan"}\\n' + longFence,
  tilde: '~~~json\\n{"kind":"plan"}\\n~~~',
  trailing: fence + 'json\\n{"kind":"plan"}\\n' + fence + ' trailing',
};
console.log(JSON.stringify({
  type: 'assistant.message',
  data: {phase: 'final_answer', model: 'gpt-fixed', content: outputs[process.env.SCENARIO]},
}));
console.log(JSON.stringify({
  type: 'session.usage_checkpoint',
  data: {totalNanoAiu: 250000000},
}));
console.log(JSON.stringify({type: 'result', exitCode: 0}));
`,
      );
      await chmod(executable, 0o755);
      const module =
        (await import("../packages/analysis/src/hoh.js")) as Record<
          string,
          unknown
        >;
      const invoke = module.invokeCopilotRole as (
        input: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>;
      const common = {
        executable,
        cwd: root,
        role: "planner",
        prompt: "fence protocol",
        config: parseHohConfig({
          model: "gpt-fixed",
          budget: { aiCredits: 10 },
          commands: { test: ["npm", "test"] },
          limits: { roleOutputRetryLimit: 1 },
        }),
        policy: derivePolicy("planner", {}),
        reserveAttempt: async () => "reservation",
        settleAttempt: async () => undefined,
        abandonAttempt: async () => undefined,
        validate: (value: unknown) => value,
      };
      const environment = {
        VERSION_SENTINEL: resolve(root, "version-probed"),
      };

      for (const scenario of ["raw", "fenced"]) {
        await expect(
          invoke({
            ...common,
            environment: { ...environment, SCENARIO: scenario },
          }),
        ).resolves.toMatchObject({ value: { kind: "plan" } });
      }
      for (const scenario of [
        "prose",
        "multiple",
        "incomplete",
        "uppercase",
        "padded",
        "long",
        "tilde",
        "trailing",
      ]) {
        await expect(
          invoke({
            ...common,
            environment: { ...environment, SCENARIO: scenario },
          }),
        ).rejects.toThrow(/final answer content|retries exhausted/i);
      }
    });

    /** @id TEST-HOH-COPILOT-ADAPTER-007
     * @verifies REQ-AUTONOMOUS-DEVELOPMENT-013
     */
    it("TEST-HOH-COPILOT-ADAPTER-007 separates Copilot tool names from permission kinds and preserves current version resolution", async () => {
      const root = await fixture();
      const executable = resolve(root, "fake-copilot-tools.mjs");
      await writeFile(
        executable,
        `#!/usr/bin/env node
import fs from 'node:fs';
const capture = process.env.CAPTURE;
if (process.argv.includes('--version')) {
  if (capture) fs.writeFileSync(capture, JSON.stringify({kind:'version',autoUpdate:process.env.COPILOT_AUTO_UPDATE ?? null}));
  console.log(process.env.PROBE_VERSION ?? '1.2.3');
  if (process.env.SCENARIO === 'probe-nonzero') {
    console.error('probe failed');
    process.exit(7);
  }
  process.exit(0);
}
if (capture) fs.writeFileSync(capture, JSON.stringify({kind:'role',argv:process.argv.slice(2),autoUpdate:process.env.COPILOT_AUTO_UPDATE ?? null}));
if (process.env.SCENARIO === 'unknown-tool') {
  console.log(JSON.stringify({type:'session.info',data:{infoType:'configuration',message:'Unknown tool name in the tool allowlist: "bogus"'}}));
}
if (process.env.SCENARIO === 'disabled-tools') {
  console.log(JSON.stringify({type:'session.info',data:{infoType:'configuration',message:'Disabled tools: shell'}}));
}
console.log(JSON.stringify({type:'session.usage_checkpoint',data:{totalNanoAiu:1000000000}}));
console.log(JSON.stringify({type:'assistant.message',data:{phase:'final_answer',model:'gpt-fixed',content:'{"executionRecords":[{"status":"completed"}]}'}}));
console.log(JSON.stringify({type:'result',exitCode:0}));
`,
      );
      await chmod(executable, 0o755);
      const module =
        (await import("../packages/analysis/src/hoh.js")) as Record<
          string,
          unknown
        >;
      const invoke = module.invokeCopilotRole as (
        input: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>;
      const capture = resolve(root, "capture.json");
      const toolSegments = JSON.parse(
        await readFile(
          resolve(
            process.cwd(),
            "tests/fixtures/copilot-cli-1.0.86-tool-segments.json",
          ),
          "utf8",
        ),
      ) as { developer: string[]; readOnly: string[] };
      const common = {
        executable,
        cwd: root,
        role: "developer",
        prompt: "implement",
        config: parseHohConfig({
          model: "gpt-fixed",
          copilotCliVersion: "1.2.3",
          budget: { aiCredits: 30 },
          commands: { test: ["npm", "test"] },
        }),
        policy: derivePolicy("developer", {}),
        environment: {
          CAPTURE: capture,
          COPILOT_AUTO_UPDATE: "false",
        },
        validate: (value: unknown) => value,
      };
      for (const role of ["planner", "developer", "qa", "reviewer"] as const) {
        const roleCapture = resolve(root, `${role}-capture.json`);
        const roleResult = await invoke({
          ...common,
          role,
          policy: derivePolicy(role, {}),
          environment: {
            ...common.environment,
            CAPTURE: roleCapture,
          },
        });
        const captured = JSON.parse(await readFile(roleCapture, "utf8")) as {
          argv: string[];
          autoUpdate: string | null;
        };
        const availableIndex = captured.argv.indexOf("--available-tools");
        const allowIndex = captured.argv.indexOf("--allow-tool");
        const denyIndex = captured.argv.indexOf("--deny-tool");
        const expectedTools =
          role === "developer"
            ? toolSegments.developer
            : toolSegments.readOnly;
        expect(
          captured.argv.slice(
            availableIndex + 1,
            allowIndex === -1 ? denyIndex : allowIndex,
          ),
        ).toEqual(expectedTools);
        if (role === "developer")
          expect(captured.argv.slice(allowIndex + 1, denyIndex)).toEqual([
            "write",
          ]);
        else expect(allowIndex).toBe(-1);
        expect(captured.argv.slice(denyIndex + 1)).toEqual(["shell"]);
        expect(captured.argv).not.toContain("--no-auto-update");
        expect(captured.autoUpdate).toBeNull();
        expect(roleResult.records).toEqual([
          expect.objectContaining({ argv: [executable, "--version"] }),
          expect.objectContaining({
            argv: expect.arrayContaining([executable, "--available-tools"]),
          }),
        ]);
      }
      expect(derivePolicy("developer", {}).allowTools).toEqual([
        "read",
        "write",
      ]);
      for (const role of ["planner", "developer", "qa", "reviewer"] as const)
        expect(() => derivePolicy(role, { allowTools: [] })).toThrow(
          /non-empty|available tool/i,
        );
      expect(() =>
        derivePolicy("developer", { allowTools: ["unknown"] }),
      ).toThrow(/unknown.*capability/i);
      expect(() =>
        derivePolicy("qa", { allowTools: ["write"] }),
      ).toThrow(/allowWrite/i);
      expect(() =>
        derivePolicy("developer", { allowTools: ["write"] }),
      ).toThrow(/requires.*read/i);
      for (const role of ["planner", "qa", "reviewer"] as const) {
        expect(derivePolicy(role, { allowWrite: true }).allowWrite).toBe(true);
        expect(() =>
          derivePolicy(role, {
            allowTools: ["read", "write"],
            allowWrite: true,
          }),
        ).toThrow(/developer|write/i);
      }
      expect(
        derivePolicy("deployment", { allowWrite: true }).allowWrite,
      ).toBe(true);
      expect(() =>
        derivePolicy("deployment", {
          allowTools: ["read", "write"],
          allowWrite: true,
        }),
      ).toThrow(/developer|write/i);

      let reservations = 0;
      await expect(
        invoke({
          ...common,
          environment: { ...common.environment, SCENARIO: "unknown-tool" },
          reserveAttempt: async () => {
            reservations += 1;
            return "reservation";
          },
          abandonAttempt: async () => undefined,
        }),
      ).rejects.toThrow(/unknown tool name/i);
      expect(reservations).toBe(1);
      await expect(
        invoke({
          ...common,
          environment: {
            ...common.environment,
            SCENARIO: "disabled-tools",
          },
        }),
      ).resolves.toMatchObject({ attempts: 1 });

      reservations = 0;
      await expect(
        invoke({
          ...common,
          config: parseHohConfig({
            model: "gpt-fixed",
            budget: { aiCredits: 30 },
            commands: { test: ["npm", "test"] },
          }),
          environment: {
            ...common.environment,
            PROBE_VERSION: "1.0.85",
          },
          reserveAttempt: async () => {
            reservations += 1;
            return "reservation";
          },
        }),
      ).rejects.toThrow(/1\.0\.86|minimum|unsupported/i);
      expect(reservations).toBe(0);
      await expect(
        invoke({
          ...common,
          config: parseHohConfig({
            model: "gpt-fixed",
            budget: { aiCredits: 30 },
            commands: { test: ["npm", "test"] },
          }),
          environment: {
            ...common.environment,
            PROBE_VERSION: "not-a-version",
          },
        }),
      ).rejects.toThrow(/version|unsupported|unparsable/i);
      await expect(
        invoke({
          ...common,
          config: parseHohConfig({
            model: "gpt-fixed",
            budget: { aiCredits: 30 },
            commands: { test: ["npm", "test"] },
          }),
          environment: {
            ...common.environment,
            PROBE_VERSION: "1.0.100",
          },
        }),
      ).resolves.toMatchObject({ attempts: 1 });
      await expect(
        invoke({
          ...common,
          config: parseHohConfig({
            model: "gpt-fixed",
            copilotCliVersion: "1.0.86-beta.1+build.7",
            budget: { aiCredits: 30 },
            commands: { test: ["npm", "test"] },
          }),
          environment: {
            ...common.environment,
            PROBE_VERSION:
              "\tGitHub Copilot CLI 1.0.86-beta.1+build.7. \r\nUpdate available",
          },
        }),
      ).resolves.toMatchObject({ attempts: 1 });
      await expect(
        invoke({
          ...common,
          config: parseHohConfig({
            model: "gpt-fixed",
            budget: { aiCredits: 30 },
            commands: { test: ["npm", "test"] },
          }),
          environment: {
            ...common.environment,
            PROBE_VERSION:
              "GitHub Copilot CLI 1.0.86.\nRun 'copilot update' to check for updates.",
          },
        }),
      ).resolves.toMatchObject({ attempts: 1 });
      await expect(
        invoke({
          ...common,
          config: parseHohConfig({
            model: "gpt-fixed",
            budget: { aiCredits: 30 },
            commands: { test: ["npm", "test"] },
          }),
          environment: {
            ...common.environment,
            PROBE_VERSION: "1.0.100.",
          },
        }),
      ).resolves.toMatchObject({ attempts: 1 });
      for (const probeVersion of [
        "notice 0.0.1) GitHub Copilot CLI 1.0.100",
        "GitHub Copilot CLI 1.0.100..",
        "Update from 1.0.85 to 1.0.100",
      ]) {
        await expect(
          invoke({
            ...common,
            config: parseHohConfig({
              model: "gpt-fixed",
              budget: { aiCredits: 30 },
              commands: { test: ["npm", "test"] },
            }),
            environment: {
              ...common.environment,
              PROBE_VERSION: probeVersion,
            },
          }),
        ).rejects.toThrow(/version|unsupported|unparsable/i);
      }
      await expect(
        invoke({
          ...common,
          config: parseHohConfig({
            model: "gpt-fixed",
            budget: { aiCredits: 30 },
            commands: { test: ["npm", "test"] },
          }),
          environment: {
            ...common.environment,
            PROBE_VERSION: "GitHub Copilot CLI v1.0.100",
          },
        }),
      ).rejects.toThrow(/version|unsupported|unparsable/i);
      expect(() =>
        parseHohConfig({
          model: "gpt-fixed",
          copilotCliVersion: "v1.0.86",
          budget: { aiCredits: 30 },
          commands: { test: ["npm", "test"] },
        }),
      ).toThrow(/copilotCliVersion|version/i);
      const probeFailure = await invoke({
        ...common,
        config: parseHohConfig({
          model: "gpt-fixed",
          budget: { aiCredits: 30 },
          commands: { test: ["npm", "test"] },
        }),
        environment: {
          ...common.environment,
          SCENARIO: "probe-nonzero",
        },
      }).catch((error: unknown) => error);
      expect(probeFailure).toMatchObject({
        name: "CopilotRoleConfigurationError",
        records: [
          expect.objectContaining({
            argv: [executable, "--version"],
            exitCode: 7,
          }),
        ],
      });
    });

    /** @id TEST-HOH-COPILOT-ADAPTER-005
     * @verifies REQ-AUTONOMOUS-DEVELOPMENT-004
     */
    it("TEST-HOH-COPILOT-ADAPTER-005 preserves exact nano-AIU and fails closed on truncated output", async () => {
      const root = await fixture();
      const executable = resolve(root, "fake-copilot-bounds.mjs");
      await writeFile(
        executable,
        `#!/usr/bin/env node
import fs from 'node:fs';
if (process.argv.includes('--version')) {
  fs.writeFileSync(process.env.VERSION_SENTINEL, 'probed');
  console.log('GitHub Copilot CLI 1.2.3');
  process.exit(0);
}
if (!fs.existsSync(process.env.VERSION_SENTINEL)) process.exit(3);
const exactNanoAiu = 543795648780;
const events = [
  {type:'assistant.message',data:{phase:'final_answer',model:'gpt-fixed',content:'{"kind":"plan"}'}},
  ...(process.env.SCENARIO === 'fallback' ? [] : [{type:'session.usage_checkpoint',data:{totalNanoAiu:exactNanoAiu}}]),
  {type:'result',exitCode:0},
];
if (process.env.SCENARIO === 'truncated') {
  const compact = [
    {type:'assistant.message',data:{phase:'final_answer',model:'gpt-fixed',content:'{"kind":"plan"}'}},
    {type:'result',exitCode:0},
  ];
  process.stdout.write(compact.map((event) => JSON.stringify(event)).join('\\n') + '\\n'.repeat(2048));
} else {
  for (const event of events) console.log(JSON.stringify(event));
}
`,
      );
      await chmod(executable, 0o755);
      const module =
        (await import("../packages/analysis/src/hoh.js")) as Record<
          string,
          unknown
        >;
      const invoke = module.invokeCopilotRole as (
        input: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>;
      const lifecycle: string[] = [];
      const common = {
        executable,
        cwd: root,
        role: "planner",
        prompt: "bounded protocol",
        config: parseHohConfig({
          model: "gpt-fixed",
          budget: { aiCredits: 600 },
          commands: { test: ["npm", "test"] },
          limits: { roleOutputRetryLimit: 1 },
        }),
        policy: derivePolicy("planner", {}),
        reserveAttempt: async () => {
          lifecycle.push("reserve");
          return "reservation";
        },
        settleAttempt: async (
          _id: string,
          usage: number,
          actualNanoAiu?: number,
        ) => {
          lifecycle.push(`settle:${usage}:${actualNanoAiu}`);
        },
        abandonAttempt: async () => {
          lifecycle.push("abandon");
        },
        validate: (value: unknown) => value,
      };

      await invoke({
        ...common,
        environment: {
          SCENARIO: "exact",
          VERSION_SENTINEL: resolve(root, "version-probed"),
        },
      });
      expect(lifecycle).toEqual([
        "reserve",
        "settle:543.79564878:543795648780",
      ]);
      const store = new FileRunStore(root);
      const run = await store.create({
        source: { kind: "prompt", text: "exact metering" },
        config: common.config,
      });
      const reservation = await store.reserveAttemptBudget(
        run.id,
        "planner",
        1,
      );
      await store.settleAttemptBudget(
        run.id,
        reservation,
        543.79564878,
        543795648780,
      );
      expect(await store.status(run.id)).toMatchObject({
        usage: { aiCredits: 543.79564878, reserved: 0 },
        usageNanoAiu: { consumed: 543795648780, reserved: 0 },
        attempts: [
          expect.objectContaining({
            actual: 543.79564878,
            actualNanoAiu: 543795648780,
          }),
        ],
      });

      lifecycle.length = 0;
      await invoke({
        ...common,
        environment: {
          SCENARIO: "fallback",
          VERSION_SENTINEL: resolve(root, "version-probed"),
        },
      });
      expect(lifecycle).toEqual([
        "reserve",
        "settle:1:1000000000",
      ]);

      lifecycle.length = 0;
      await expect(
        invoke({
          ...common,
          config: {
            ...common.config,
            budget: { aiCredits: 10 },
          },
          environment: {
            SCENARIO: "exact",
            VERSION_SENTINEL: resolve(root, "version-probed"),
          },
        }),
      ).rejects.toThrow(/budget/i);
      expect(lifecycle).toEqual([
        "reserve",
        "settle:543.79564878:543795648780",
      ]);

      lifecycle.length = 0;
      await expect(
        invoke({
          ...common,
          config: {
            ...common.config,
            maxCommandOutputBytes: 128,
          },
          environment: {
            SCENARIO: "truncated",
            VERSION_SENTINEL: resolve(root, "version-probed"),
          },
        }),
      ).rejects.toThrow(/output exceeded the configured byte bound/i);
      expect(lifecycle).toEqual([
        "reserve",
        "abandon",
        "reserve",
        "abandon",
      ]);
    });

    /** @id TEST-HOH-GIT-STORE-002
     * @verifies REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-009 REQ-AUTONOMOUS-DEVELOPMENT-014 REQ-AUTONOMOUS-DEVELOPMENT-018
     */
    it("TEST-HOH-GIT-STORE-002 snapshots candidates and QA without mutating the user worktree or index", async () => {
      const root = await fixture({
        "tracked.txt": "base\n",
        "extra.txt": "candidate\n",
      });
      spawnSync("git", ["init", "-q"], { cwd: root });
      spawnSync("git", ["config", "user.email", "test@example.com"], {
        cwd: root,
      });
      spawnSync("git", ["config", "user.name", "Test"], { cwd: root });
      spawnSync("git", ["add", "tracked.txt"], { cwd: root });
      spawnSync("git", ["commit", "-qm", "base"], { cwd: root });
      await writeFile(resolve(root, "tracked.txt"), "user-change\n");
      spawnSync("git", ["add", "tracked.txt"], { cwd: root });
      const beforeStatus = spawnSync("git", ["status", "--porcelain=v1"], {
        cwd: root,
        encoding: "utf8",
      }).stdout;
      const module =
        (await import("../packages/analysis/src/hoh.js")) as Record<
          string,
          unknown
        >;
      const Store = module.GitCandidateStore as
        | (new (
            root: string,
            runId: string,
            extraPaths: string[],
          ) => {
            initialize(): Promise<Record<string, string>>;
            snapshotStage(stage: string): Promise<CandidateSnapshot>;
            createQaWorkspace(
              candidate: CandidateSnapshot,
            ): Promise<{ path: string }>;
            verifyCandidateUnchanged(
              workspace: { path: string },
              candidate: CandidateSnapshot,
            ): Promise<boolean>;
            cleanupQaWorkspace(workspace: { path: string }): Promise<void>;
          })
        | undefined;
      expect(Store).toBeTypeOf("function");
      const store = new Store!(root, "run-1", ["extra.txt"]);
      const initialized = await store.initialize();
      expect(initialized.baseRef).toBe("refs/musubix4/runs/run-1/base");
      const candidate = await store.snapshotStage("developer-1");
      expect(candidate.ref).toBe("refs/musubix4/runs/run-1/stages/developer-1");
      const qa = await store.createQaWorkspace(candidate);
      expect(await readFile(resolve(qa.path, "tracked.txt"), "utf8")).toBe(
        "user-change\n",
      );
      expect(await readFile(resolve(qa.path, "extra.txt"), "utf8")).toBe(
        "candidate\n",
      );
      await chmod(resolve(qa.path, "tracked.txt"), 0o644);
      await writeFile(resolve(qa.path, "tracked.txt"), "tampered\n");
      expect(await store.verifyCandidateUnchanged(qa, candidate)).toBe(false);
      await store.cleanupQaWorkspace(qa);
      await expect(stat(qa.path)).rejects.toThrow();
      expect(
        spawnSync("git", ["status", "--porcelain=v1"], {
          cwd: root,
          encoding: "utf8",
        }).stdout,
      ).toBe(beforeStatus);
    });

    /** @id TEST-HOH-GIT-DEPLOYMENT-003
     * @verifies REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-014 REQ-AUTONOMOUS-DEVELOPMENT-017 REQ-AUTONOMOUS-DEVELOPMENT-018
     */
    it("TEST-HOH-GIT-DEPLOYMENT-003 preserves Git modes and recovers deployment crashes exactly once", async () => {
      if (process.platform !== "linux") return;
      const root = await fixture({
        "script.sh": "#!/bin/sh\necho ok\n",
        "target.txt": "target\n",
      });
      await chmod(resolve(root, "script.sh"), 0o755);
      await symlink("target.txt", resolve(root, "link.txt"));
      spawnSync("git", ["init", "-q"], { cwd: root });
      spawnSync("git", ["config", "user.email", "test@example.com"], {
        cwd: root,
      });
      spawnSync("git", ["config", "user.name", "Test"], { cwd: root });
      spawnSync("git", ["add", "."], { cwd: root });
      spawnSync("git", ["commit", "-qm", "base"], { cwd: root });
      const module =
        (await import("../packages/analysis/src/hoh.js")) as Record<
          string,
          unknown
        >;
      const Store = module.GitCandidateStore as new (
        root: string,
        runId: string,
        extras: string[],
      ) => {
        initialize(): Promise<unknown>;
        snapshotStage(stage: string): Promise<CandidateSnapshot>;
        createQaWorkspace(
          candidate: CandidateSnapshot,
        ): Promise<{ path: string }>;
        cleanupQaWorkspace(workspace: { path: string }): Promise<void>;
      };
      const store = new Store(root, "fidelity", []);
      await store.initialize();
      const candidate = await store.snapshotStage("developer");
      const qa = await store.createQaWorkspace(candidate);
      expect((await stat(resolve(qa.path, "script.sh"))).mode & 0o111).toBe(
        0o111,
      );
      expect((await lstat(resolve(qa.path, "link.txt"))).isSymbolicLink()).toBe(
        true,
      );
      expect(await readFile(resolve(qa.path, "link.txt"), "utf8")).toBe(
        "target\n",
      );
      await store.cleanupQaWorkspace(qa);

      const log = resolve(root, "deployment.log");
      const executable = resolve(root, "deployment.mjs");
      await writeFile(
        executable,
        `#!/usr/bin/env node
import fs from 'node:fs';
fs.appendFileSync(process.env.LOG, process.argv[2] + '\\n');
process.exit(0);
`,
      );
      await chmod(executable, 0o755);
      const journalPath = resolve(root, ".musubix4/deployment.json");
      const recoverDeployment = module.recoverDeployment as
        | ((input: Record<string, unknown>) => Promise<Record<string, unknown>>)
        | undefined;
      expect(recoverDeployment).toBeTypeOf("function");
      await writeFile(
        journalPath,
        JSON.stringify({
          schemaVersion: 1,
          candidateDigest: candidate.treeDigest,
          phase: "deploy-started",
          rollbackAttempts: 0,
        }),
      );
      const input = {
        journalPath,
        cwd: root,
        candidateDigest: candidate.treeDigest,
        commands: { rollback: [process.execPath, executable, "rollback"] },
        environment: { LOG: log },
        policy: derivePolicy("deployment", {}),
        timeoutMs: 10_000,
        maxOutputBytes: 10_000,
      };
      expect(await recoverDeployment!(input)).toMatchObject({
        status: "recovered",
        rollbackAttempts: 1,
      });
      expect(await recoverDeployment!(input)).toMatchObject({
        status: "recovered",
        rollbackAttempts: 1,
      });
      expect((await readFile(log, "utf8")).trim().split("\n")).toEqual([
        "rollback",
      ]);
    });

    /** @id TEST-HOH-APPROVAL-RUN-002
     * @verifies REQ-AUTONOMOUS-DEVELOPMENT-011 REQ-AUTONOMOUS-DEVELOPMENT-016
     */
    it("TEST-HOH-APPROVAL-RUN-002 binds an approval to the current run nonce and rejects replay", async () => {
      const root = await fixture();
      const store = new FileRunStore(root);
      const run = await store.create({
        source: { kind: "prompt", text: "A" },
        config: parseHohConfig({
          model: "gpt",
          budget: { aiCredits: 1 },
          commands: { test: ["npm", "test"] },
        }),
      });
      const module =
        (await import("../packages/analysis/src/hoh.js")) as Record<
          string,
          unknown
        >;
      const pause = module.pauseForApproval as
        | ((
            store: FileRunStore,
            runId: string,
            stage: string,
            manifestDigest: string,
          ) => Promise<RunRecord>)
        | undefined;
      const record = module.recordRunApproval as
        | ((
            store: FileRunStore,
            input: Record<string, string>,
          ) => Promise<Record<string, unknown>>)
        | undefined;
      expect(pause).toBeTypeOf("function");
      expect(record).toBeTypeOf("function");
      const paused = await pause!(store, run.id, "release", "manifest-1");
      const nonce = String(
        (paused as unknown as { approval: { nonce: string } }).approval.nonce,
      );
      await expect(
        record!(store, {
          runId: run.id,
          stage: "release",
          nonce: "stale",
          manifestDigest: "manifest-1",
          approver: "human",
        }),
      ).rejects.toThrow(/nonce/i);
      const evidence = await record!(store, {
        runId: run.id,
        stage: "release",
        nonce,
        manifestDigest: "manifest-1",
        approver: "human",
      });
      expect(evidence).toMatchObject({
        runId: run.id,
        nonce,
        decision: "approved",
      });
      await expect(
        record!(store, {
          runId: run.id,
          stage: "release",
          nonce,
          manifestDigest: "manifest-1",
          approver: "human",
        }),
      ).rejects.toThrow(/replay/i);
    });

    /** @id TEST-HOH-DEPLOYMENT-002
     * @verifies REQ-AUTONOMOUS-DEVELOPMENT-012 REQ-AUTONOMOUS-DEVELOPMENT-013 REQ-AUTONOMOUS-DEVELOPMENT-016 REQ-AUTONOMOUS-DEVELOPMENT-017
     */
    it("TEST-HOH-DEPLOYMENT-002 deploys and verifies once or rolls back exactly once with provenance", async () => {
      const root = await fixture();
      const log = resolve(root, "commands.log");
      const executable = resolve(root, "command.mjs");
      await writeFile(
        executable,
        `#!/usr/bin/env node
  import fs from 'node:fs';
  fs.appendFileSync(process.env.COMMAND_LOG, process.argv[2] + '\\n');
  process.exit(process.argv[2] === 'verify' ? 7 : 0);
  `,
      );
      await chmod(executable, 0o755);
      const module =
        (await import("../packages/analysis/src/hoh.js")) as Record<
          string,
          unknown
        >;
      const deploy = module.deployCandidate as
        | ((input: Record<string, unknown>) => Promise<Record<string, unknown>>)
        | undefined;
      expect(deploy).toBeTypeOf("function");
      const result = await deploy!({
        cwd: root,
        candidateDigest: "candidate",
        readiness: true,
        approval: {
          decision: "approved",
          manifestDigest: "manifest",
          nonce: "nonce",
        },
        expectedManifestDigest: "manifest",
        expectedNonce: "nonce",
        commands: {
          deploy: [process.execPath, executable, "deploy"],
          verify: [process.execPath, executable, "verify"],
          rollback: [process.execPath, executable, "rollback"],
        },
        environment: { COMMAND_LOG: log },
        policy: derivePolicy("deployment", {}),
        timeoutMs: 10_000,
        maxOutputBytes: 10_000,
      });
      expect(result.status).toBe("recovered");
      expect((await readFile(log, "utf8")).trim().split("\n")).toEqual([
        "deploy",
        "verify",
        "rollback",
      ]);
      expect(result.records as unknown[]).toHaveLength(3);
    });

    /** @id TEST-HOH-GITHUB-ISSUE-002
     * @verifies REQ-AUTONOMOUS-DEVELOPMENT-003 REQ-AUTONOMOUS-DEVELOPMENT-013 REQ-AUTONOMOUS-DEVELOPMENT-015
     */
    it("TEST-HOH-GITHUB-ISSUE-002 materializes an issue through an injected contained service", async () => {
      const root = await fixture();
      const module =
        (await import("../packages/analysis/src/hoh.js")) as Record<
          string,
          unknown
        >;
      const materialize = module.materializeSpecificationWithServices as
        | ((
            root: string,
            source: unknown,
            limit: number,
            services: unknown,
          ) => Promise<PublicSpecification>)
        | undefined;
      expect(materialize).toBeTypeOf("function");
      const spec = await materialize!(
        root,
        { kind: "github-issue", repository: "owner/repo", issue: 7 },
        1_048_576,
        {
          github: {
            loadIssue: async () => ({
              locator: "owner/repo#7@node-id",
              content: "# Capability\nIssue requirement.",
            }),
          },
        },
      );
      expect(spec).toMatchObject({
        source: "github-issue",
        locator: "owner/repo#7@node-id",
      });
      expect(spec.requirements).toHaveLength(2);
    });
  });

  /** @id TEST-HOH-QA-INTEGRITY-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-014 REQ-AUTONOMOUS-DEVELOPMENT-018
   */
  it("TEST-HOH-QA-INTEGRITY-001 rejects QA evidence when the candidate tree changes", async () => {
    const root = await fixture();
    const store = new FileRunStore(root);
    const snapshots: CandidateSnapshot[] = [];
    const services: HohServices = {
      roles: {
        planner: async (context) => {
          const [requirementId] = (context as { requirements: string[] })
            .requirements;
          return {
            kind: "plan",
            priorities: [
              {
                requirementId: requirementId!,
                acceptanceGates: ["test"],
                preservation: ["base"],
              },
            ],
            addressedBlockers: [],
          };
        },
        developer: async () => ({
          executionRecords: [{ command: "test", exitCode: 0 }],
          candidate: "candidate-1",
        }),
        qa: async (_context) => {
          await writeFile(resolve(root, "tracked.ts"), "changed");
          return deriveClaimMatrix(["REQ-A"]).map((claim) => ({
            claimId: claim.id,
            status: "verified" as const,
            evidence: ["test"],
          }));
        },
      },
      project: {
        preflight: async () => undefined,
        candidateChecks: async () => true,
      },
      git: {
        snapshot: async () => {
          await writeFile(resolve(root, "tracked.ts"), "base");
          const snapshot = {
            ref: "refs/musubix4/candidate-1",
            treeDigest: "before",
          };
          snapshots.push(snapshot);
          return snapshot;
        },
        treeDigest: async () =>
          (await readFile(resolve(root, "tracked.ts"), "utf8")) === "base"
            ? "before"
            : "after",
        rollback: async () => undefined,
      },
    };
    const orchestrator = new HohOrchestrator(store, services);
    const run = await orchestrator.start({
      source: { kind: "prompt", text: "Requirement A" },
      config: parseHohConfig({
        model: "gpt-5.4",
        budget: { aiCredits: 10 },
        commands: { test: ["npm", "test"] },
      }),
    });
    await orchestrator.resume(run.id);
    await orchestrator.resume(run.id);
    const status = await orchestrator.resume(run.id);
    expect(status.state).toBe("failed");
    expect(status.terminalReason).toBe("qa-tree-modified");
    expect(snapshots).toHaveLength(1);
  });

  /** @id TEST-HOH-RECOVERY-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-004 REQ-AUTONOMOUS-DEVELOPMENT-011 REQ-AUTONOMOUS-DEVELOPMENT-012 REQ-AUTONOMOUS-DEVELOPMENT-014
   */
  it("TEST-HOH-RECOVERY-001 persists transitions, rejects live writers, reclaims dead locks, and stops resumably", async () => {
    const root = await fixture();
    const store = new FileRunStore(root);
    const run = await store.create({
      source: { kind: "prompt", text: "A" },
      config: parseHohConfig({
        model: "gpt-5.4",
        budget: { aiCredits: 1 },
        commands: { test: ["npm", "test"] },
      }),
    });
    const lease = await store.acquire(run.id, {
      pid: process.pid,
      owner: "first",
    });
    await expect(
      store.acquire(run.id, { pid: process.pid, owner: "second" }),
    ).rejects.toThrow(/locked/);
    await store.release(lease);
    const lockPath = resolve(root, ".musubix4/runs", run.id, "writer.lock");
    await writeFile(
      lockPath,
      JSON.stringify({ pid: 999_999_999, owner: "dead", nonce: "old" }),
    );
    const reclaimed = await store.acquire(run.id, {
      pid: process.pid,
      owner: "new",
    });
    await store.release(reclaimed);
    const stopped = await store.stop(run.id, "cancelled");
    expect(stopped.state).toBe("stopped");
    expect(stopped.journal.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
    expect((await store.status(run.id)).terminalReason).toBe("cancelled");
    await chmod(resolve(root, ".musubix4/runs", run.id), 0o700);
  });
});
