import { describe, expect, it, vi } from 'vitest';
import {
  FileRunStore,
  HohOrchestrator,
  parseHohConfig,
  type HohServices,
} from '../packages/analysis/src/hoh.js';
import { fixture } from './helpers.js';

/** @id TEST-AUTONOMOUS-AUTO-APPROVAL-REPAIR-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-016
 */
describe('automatic approval repair routing', () => {
  it('TEST-AUTONOMOUS-AUTO-APPROVAL-REPAIR-001 preserves a non-terminal boundary while attempts remain', async () => {
    const root = await fixture();
    const store = new FileRunStore(root);
    const created = await store.create({
      source: { kind: 'prompt', text: 'Build safely' },
      config: parseHohConfig({
        model: 'gpt-5.4',
        budget: { aiCredits: 10 },
        commands: { test: ['npm', 'test'] },
        approval: { mode: 'verified-auto', boundaryAttemptLimit: 2 },
      }),
      requirements: ['REQ-AUTONOMOUS-DEVELOPMENT-016'],
    });
    let invalid = true;
    const reviewer = vi.fn(async (context: unknown) => {
      if (invalid) return { findings: [] };
      const boundary = context as {
        stage: string;
        boundaryKind: string;
        boundaryEpisodeOrdinal: number;
        nonce: string;
        manifestDigest: string;
        manifestPaths: string[];
      };
      return { ...boundary, reviewedPaths: boundary.manifestPaths, findings: [] };
    });
    const services: HohServices = {
      roles: {
        planner: vi.fn().mockResolvedValue({
          kind: 'plan',
          priorities: [{
            requirementId: 'REQ-AUTONOMOUS-DEVELOPMENT-016',
            acceptanceGates: ['verified approval'],
            preservation: ['existing behavior'],
          }],
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
    const orchestrator = new HohOrchestrator(store, services);

    const repair = await orchestrator.resume(created.id);

    expect(repair.state).toBe('created');
    expect(repair.terminalReason).toBeUndefined();
    expect(repair.journal.at(-1)?.event).toBe('approval-repair-required');
    expect(Object.values(repair.approvalAttempts ?? {})).toEqual([1]);

    invalid = false;
    const planned = await orchestrator.resume(created.id);

    expect(planned.state).toBe('planned');
    expect(planned.journal.some((entry) => entry.event === 'approval-auto-approved')).toBe(true);
  });
});
