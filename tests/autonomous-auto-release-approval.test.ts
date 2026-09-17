import { describe, expect, it, vi } from 'vitest';
import {
  FileRunStore,
  HohOrchestrator,
  parseHohConfig,
  type HohServices,
  type MandatoryQaCheck,
} from '../packages/analysis/src/hoh.js';
import { fixture } from './helpers.js';

/** @id TEST-AUTONOMOUS-AUTO-RELEASE-APPROVAL-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-016
 */
describe('verified automatic release approval', () => {
  it('TEST-AUTONOMOUS-AUTO-RELEASE-APPROVAL-001 advances readiness without interactive approval', async () => {
    const root = await fixture();
    const store = new FileRunStore(root);
    const created = await store.create({
      source: { kind: 'prompt', text: 'Build safely' },
      config: parseHohConfig({
        model: 'gpt-5.4',
        budget: { aiCredits: 10 },
        commands: { test: ['npm', 'test'] },
      }),
      requirements: ['REQ-AUTONOMOUS-DEVELOPMENT-016'],
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
    const reviewer = vi.fn(async (context: unknown) => {
      const boundary = context as {
        stage: string;
        boundaryKind: string;
        boundaryEpisodeOrdinal: number;
        nonce: string;
        manifestDigest: string;
        manifestPaths: string[];
      };
      return {
        stage: boundary.stage,
        boundaryKind: boundary.boundaryKind,
        boundaryEpisodeOrdinal: boundary.boundaryEpisodeOrdinal,
        nonce: boundary.nonce,
        manifestDigest: boundary.manifestDigest,
        reviewedPaths: boundary.manifestPaths,
        findings: [],
      };
    });
    const services: HohServices = {
      roles: {
        planner: vi.fn(),
        developer: vi.fn(),
        qa: vi.fn().mockResolvedValue([]),
        reviewer,
      },
      project: {
        preflight: vi.fn(),
        candidateChecks: vi.fn(),
        mandatoryChecks: vi.fn().mockResolvedValue(checks),
      },
      git: {
        snapshot: vi.fn(),
        treeDigest: vi.fn().mockResolvedValue(candidate.treeDigest),
        rollback: vi.fn(),
        createQaWorkspace: vi.fn().mockResolvedValue({ path: root, candidate }),
        cleanupQaWorkspace: vi.fn(),
      },
    };

    const result = await new HohOrchestrator(store, services).resume(created.id);

    expect(reviewer).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      state: 'ready',
      requiredOperatorAction: 'none',
      approval: {
        stage: 'release',
        decision: 'approved',
        automated: true,
      },
    });
  });
});
