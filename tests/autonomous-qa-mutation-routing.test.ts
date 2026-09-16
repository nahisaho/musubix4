import { describe, expect, it, vi } from 'vitest';
import {
  FileRunStore,
  HohOrchestrator,
  parseHohConfig,
  type HohServices,
  type MandatoryQaCheck,
} from '../packages/analysis/src/hoh.js';
import { fixture } from './helpers.js';

/** @id TEST-AUTONOMOUS-QA-MUTATION-ROUTING-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-006 REQ-AUTONOMOUS-DEVELOPMENT-018
 */
describe('QA mutation routing', () => {
  it('TEST-AUTONOMOUS-QA-MUTATION-ROUTING-001 routes a changed QA tree to Developer blocker repair', async () => {
    const root = await fixture();
    const store = new FileRunStore(root);
    const created = await store.create({
      source: { kind: 'prompt', text: 'Build safely' },
      config: parseHohConfig({
        model: 'gpt-5.4',
        budget: { aiCredits: 10 },
        commands: { test: ['npm', 'test'] },
      }),
      requirements: ['REQ-AUTONOMOUS-DEVELOPMENT-006'],
    });
    const candidate = {
      ref: 'refs/musubix4/runs/test/stages/candidate',
      treeDigest: 'a'.repeat(40),
    };
    const current = await store.transition(created.id, 'candidate', 'test-candidate');
    current.candidate = candidate;
    current.iteration = 1;
    await store.save(current);
    const checks: MandatoryQaCheck[] = [
      'build',
      'focused-test',
      'static-validation',
      'trace',
      'dependency-cycle',
      'structured-contract',
      'inherited-compatibility',
    ].map((id) => ({
      id: id as MandatoryQaCheck['id'],
      status: 'passed',
      evidence: [`evidence://${id}`],
    }));
    const services: HohServices = {
      roles: {
        planner: vi.fn(),
        developer: vi.fn(),
        qa: vi.fn().mockResolvedValue([]),
      },
      project: {
        preflight: vi.fn(),
        candidateChecks: vi.fn(),
        mandatoryChecks: vi.fn().mockResolvedValue(checks),
      },
      git: {
        snapshot: vi.fn(),
        treeDigest: vi.fn().mockResolvedValue('b'.repeat(40)),
        rollback: vi.fn(),
        createQaWorkspace: vi.fn().mockResolvedValue({ path: root, candidate }),
        cleanupQaWorkspace: vi.fn(),
      },
    };

    const result = await new HohOrchestrator(store, services).resume(created.id);

    expect(result).toMatchObject({
      state: 'planned',
      role: 'developer',
      blockerRepairAttempts: 1,
      iteration: 1,
      stagnantIterations: 0,
      rejectedCandidates: [candidate.ref],
    });
  });
});
