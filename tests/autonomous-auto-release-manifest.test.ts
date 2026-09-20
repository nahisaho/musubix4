import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  FileRunStore,
  HohOrchestrator,
  parseHohConfig,
  type HohServices,
  type MandatoryQaCheck,
} from '../packages/analysis/src/hoh.js';
import { fixture } from './helpers.js';

/** @id TEST-AUTONOMOUS-AUTO-RELEASE-MANIFEST-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-016
 */
describe('automatic release approval manifest', () => {
  it('TEST-AUTONOMOUS-AUTO-RELEASE-MANIFEST-001 sends five canonical artifacts without the RunRecord', async () => {
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
      expect(context).not.toHaveProperty('run');
      expect(context).not.toHaveProperty('candidate');
      expect(context).not.toHaveProperty('claims');
      const boundary = context as {
        stage: string;
        boundaryKind: string;
        boundaryEpisodeOrdinal: number;
        nonce: string;
        manifestDigest: string;
        manifestPaths: string[];
        manifestArtifacts: Array<{ path: string; sha256: string; bytes: string }>;
      };
      expect(boundary.manifestArtifacts.map(({ path }) => path)).toEqual(boundary.manifestPaths);
      for (const artifact of boundary.manifestArtifacts) {
        expect(artifact.sha256).toBe(createHash('sha256').update(artifact.bytes).digest('hex'));
        expect(() => JSON.parse(artifact.bytes)).not.toThrow();
      }
      expect(
        JSON.parse(
          boundary.manifestArtifacts.find(
            ({ path }) => path === `.musubix/runs/${created.id}/deployment-config.json`,
          )!.bytes,
        ),
      ).toEqual({
        deploy: null,
        rollback: null,
        verify: null,
      });
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

    expect(result.state).toBe('ready');
    expect((reviewer.mock.calls[0]?.[0] as {
      manifestArtifacts: Array<{ path: string }>;
    }).manifestArtifacts.map(({ path }) => path)).toEqual([
      `.musubix/runs/${created.id}/candidate.json`,
      `.musubix/runs/${created.id}/claim-matrix.json`,
      `.musubix/runs/${created.id}/mandatory-checks.json`,
      `.musubix/runs/${created.id}/trace.json`,
      `.musubix/runs/${created.id}/deployment-config.json`,
    ]);
  });
});
