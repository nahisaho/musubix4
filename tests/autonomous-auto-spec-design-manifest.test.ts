import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  FileRunStore,
  HohOrchestrator,
  parseHohConfig,
  type HohServices,
} from '../packages/analysis/src/hoh.js';
import { fixture } from './helpers.js';

/** @id TEST-AUTONOMOUS-AUTO-SPEC-DESIGN-MANIFEST-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-016
 */
describe('automatic specification approval manifests', () => {
  it('TEST-AUTONOMOUS-AUTO-SPEC-DESIGN-MANIFEST-001 sends canonical artifacts without the RunRecord', async () => {
    const root = await fixture();
    const store = new FileRunStore(root);
    const reviewer = vi.fn(async (context: unknown) => {
      expect(context).not.toHaveProperty('run');
      const boundary = context as {
        stage: string;
        boundaryKind: string;
        nonce: string;
        manifestDigest: string;
        manifestPaths: string[];
        manifestArtifacts: Array<{ path: string; sha256: string; bytes: string }>;
      };
      expect(boundary.manifestArtifacts.map(({ path }) => path)).toEqual(boundary.manifestPaths);
      for (const artifact of boundary.manifestArtifacts) {
        expect(artifact.sha256).toBe(createHash('sha256').update(artifact.bytes).digest('hex'));
      }
      return {
        stage: boundary.stage,
        boundaryKind: boundary.boundaryKind,
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

    await new HohOrchestrator(store, services).resume(run.id);

    expect(reviewer.mock.calls.map(([context]) => (
      context as { manifestArtifacts: Array<{ path: string }> }
    ).manifestArtifacts.map(({ path }) => path))).toEqual([
      ['public-specification', 'effective-run-config'],
      ['planner-design'],
    ]);
  });
});
