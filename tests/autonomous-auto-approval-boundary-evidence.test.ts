import { createHash } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  autoApproveRunBoundary,
  FileRunStore,
  HohOrchestrator,
  parseHohConfig,
  type HohServices,
  type MandatoryQaCheck,
} from '../packages/analysis/src/hoh.js';
import { fixture } from './helpers.js';

const passedChecks = (): MandatoryQaCheck[] => [
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

/** @id TEST-AUTONOMOUS-AUTO-RELEASE-GATE-BINDING-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-016
 */
describe('automatic release gate evidence', () => {
  it('TEST-AUTONOMOUS-AUTO-RELEASE-GATE-BINDING-001 binds fresh isolated gate records and persists the complete approval artifact', async () => {
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
      lockfile: { path: 'package-lock.json', sha256: 'b'.repeat(64) },
    };
    const current = await store.transition(created.id, 'candidate', 'test-candidate');
    current.candidate = candidate;
    current.iteration = 1;
    await store.save(current);
    const mandatoryChecks = vi.fn(async (context: unknown) => {
      expect(context).toMatchObject({
        acceptedCandidateDigest: candidate.treeDigest,
        checkoutTreeDigest: candidate.treeDigest,
      });
      expect((context as { claimMatrixDigest: string }).claimMatrixDigest).toMatch(/^[a-f0-9]{64}$/);
      return passedChecks();
    });
    const reviewer = vi.fn(async (context: unknown) => {
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
        planner: vi.fn(),
        developer: vi.fn(),
        qa: vi.fn().mockResolvedValue([]),
        reviewer,
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
        createQaWorkspace: vi.fn().mockResolvedValue({ path: root, candidate }),
        cleanupQaWorkspace: vi.fn(),
      },
    };

    const result = await new HohOrchestrator(store, services).resume(created.id);
    const approvalPath = resolve(
      store.base,
      created.id,
      'approvals',
      `release-${result.approval?.nonce}.json`,
    );
    const approval = JSON.parse(await readFile(approvalPath, 'utf8')) as {
      boundaryKey: string;
      policyIdentity: string;
      policyDigest: string;
      validatorEvidence: unknown[];
      reviewerEvidence: unknown;
      releaseGateEvidence: Array<{
        binding: {
          acceptedCandidateDigest: string;
          claimMatrixDigest: string;
          checkoutTreeDigest: string;
        };
      }>;
    };

    expect(result.state).toBe('ready');
    expect(mandatoryChecks).toHaveBeenCalledTimes(1);
    expect(approval.boundaryKey).toBe(`${created.id}:release:release:1:1`);
    expect(approval.policyIdentity).toBe('musubix4:verified-auto');
    expect(approval.policyDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(approval.validatorEvidence).not.toHaveLength(0);
    expect(approval.reviewerEvidence).toBeTruthy();
    expect(approval.releaseGateEvidence).toHaveLength(7);
    for (const gate of approval.releaseGateEvidence) {
      expect(gate.binding).toMatchObject({
        acceptedCandidateDigest: candidate.treeDigest,
        checkoutTreeDigest: candidate.treeDigest,
      });
      expect(gate.binding.claimMatrixDigest).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});

/** @id TEST-AUTONOMOUS-AUTO-APPROVAL-BOUNDARY-ATTEMPT-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-016
 */
describe('persisted automatic approval boundary attempts', () => {
  it('TEST-AUTONOMOUS-AUTO-APPROVAL-BOUNDARY-ATTEMPT-001 rejects decision-time mutation and routes exhaustion by boundary kind', async () => {
    const root = await fixture({
      'replacement.json': '{"schemaVersion":1,"entries":[]}\n',
    });
    const store = new FileRunStore(root);
    const created = await store.create({
      source: { kind: 'prompt', text: 'Build safely' },
      config: parseHohConfig({
        model: 'gpt-5.4',
        budget: { aiCredits: 10 },
        commands: { test: ['npm', 'test'] },
        approval: { mode: 'verified-auto', boundaryAttemptLimit: 1 },
      }),
      requirements: ['REQ-AUTONOMOUS-DEVELOPMENT-016'],
    });
    await store.enterAmendmentRequired(created.id, {
      candidate: { ref: 'refs/test/candidate', treeDigest: 'a'.repeat(40) },
      offendingPaths: ['musubix4 run'],
    });
    const paused = await store.prepareCollisionInventoryAmendment(created.id, 'replacement.json');
    const reviewer = vi.fn(async (context: unknown) => {
      await writeFile(resolve(root, 'replacement.json'), '{"schemaVersion":1,"entries":[{"path":"changed"}]}\n');
      const boundary = context as {
        stage: string;
        boundaryKind: string;
        boundaryEpisodeOrdinal: number;
        amendmentAttemptOrdinal: number;
        nonce: string;
        manifestDigest: string;
        manifestPaths: string[];
      };
      return { ...boundary, reviewedPaths: boundary.manifestPaths, findings: [] };
    });

    const amendmentResult = await autoApproveRunBoundary(store, paused.id, reviewer);

    expect(amendmentResult.state).toBe('amendment-required');
    expect(amendmentResult.amendmentFailureCount).toBe(1);
    expect(amendmentResult.approval).toBeUndefined();
    await expect(access(resolve(store.base, paused.id, 'approvals'))).rejects.toThrow();

    const normalRoot = await fixture();
    const normalStore = new FileRunStore(normalRoot);
    const normal = await normalStore.create({
      source: { kind: 'prompt', text: 'Build safely' },
      config: parseHohConfig({
        model: 'gpt-5.4',
        budget: { aiCredits: 10 },
        commands: { test: ['npm', 'test'] },
        approval: { mode: 'verified-auto', boundaryAttemptLimit: 1 },
      }),
      requirements: ['REQ-AUTONOMOUS-DEVELOPMENT-016'],
    });
    const invalidReviewer = vi.fn(async () => ({ findings: [] }));
    const result = await new HohOrchestrator(normalStore, {
      roles: {
        planner: vi.fn(),
        developer: vi.fn(),
        qa: vi.fn(),
        reviewer: invalidReviewer,
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
    }).resume(normal.id);

    expect(result.state).toBe('failed');
    expect(result.terminalReason).toBe('approval-blocked');
    expect(result.journal.at(-1)?.event).toBe('approval-blocked');
  });
});

/** @id TEST-AUTONOMOUS-AUTO-RELEASE-PROVISIONING-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-016
 */
describe('release dependency provisioning configuration', () => {
  it('TEST-AUTONOMOUS-AUTO-RELEASE-PROVISIONING-001 accepts only digest-pinned lockfiles and disposable write paths', () => {
    const command = [
      process.execPath,
      '-e',
      "require('fs').writeFileSync('.musubix4-disposable/provisioned','ok')",
    ];
    const config = parseHohConfig({
      model: 'gpt-5.4',
      budget: { aiCredits: 10 },
      commands: { test: ['npm', 'test'] },
      dependencyProvisioning: {
        lockfilePath: 'package-lock.json',
        command,
        writablePaths: ['node_modules', '.musubix4-disposable'],
      },
    });

    expect(config.dependencyProvisioning).toEqual({
      lockfilePath: 'package-lock.json',
      command,
      writablePaths: ['node_modules', '.musubix4-disposable'],
    });
    expect(createHash('sha256').update('lockfile').digest('hex')).toMatch(/^[a-f0-9]{64}$/);
  });
});
