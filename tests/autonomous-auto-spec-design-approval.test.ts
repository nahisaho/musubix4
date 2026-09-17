import { describe, expect, it, vi } from 'vitest';
import {
  FileRunStore,
  HohOrchestrator,
  parseHohConfig,
  type HohServices,
} from '../packages/analysis/src/hoh.js';
import { fixture } from './helpers.js';

/** @id TEST-AUTONOMOUS-AUTO-SPEC-DESIGN-APPROVAL-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-016
 */
describe('verified automatic specification approvals', () => {
  it('TEST-AUTONOMOUS-AUTO-SPEC-DESIGN-APPROVAL-001 reviews requirements and Planner design before development', async () => {
    const root = await fixture();
    const store = new FileRunStore(root);
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
        planner: vi.fn().mockResolvedValue({
          kind: 'plan',
          priorities: [{
            requirementId: 'REQ-PUBLIC-001',
            acceptanceGates: ['test'],
            preservation: ['base'],
          }],
          addressedBlockers: [],
        }),
        developer: vi.fn(),
        qa: vi.fn(),
        reviewer,
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
    const run = await new HohOrchestrator(store, services).start({
      source: { kind: 'prompt', text: 'Requirement A' },
      config: parseHohConfig({
        model: 'gpt-5.4',
        budget: { aiCredits: 10 },
        commands: { test: ['npm', 'test'] },
      }),
    });

    const result = await new HohOrchestrator(store, services).resume(run.id);

    expect(reviewer.mock.calls.map(([context]) => (context as { stage: string }).stage))
      .toEqual(['requirements', 'design']);
    expect(result.state).toBe('planned');
    expect(result.journal.filter((entry) => entry.event === 'approval-auto-approved'))
      .toHaveLength(2);
  });
});
