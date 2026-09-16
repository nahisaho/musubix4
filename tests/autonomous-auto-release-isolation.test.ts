import { spawnSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  FileRunStore,
  GitCandidateStore,
  HohOrchestrator,
  parseHohConfig,
  type HohServices,
  type MandatoryQaCheck,
} from '../packages/analysis/src/hoh.js';
import { fixture } from './helpers.js';

/** @id TEST-AUTONOMOUS-AUTO-RELEASE-WORKSPACE-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-007 REQ-AUTONOMOUS-DEVELOPMENT-016
 */
describe('isolated release workspace provisioning', () => {
  it('TEST-AUTONOMOUS-AUTO-RELEASE-WORKSPACE-001 verifies the lockfile and rejects writes outside disposable paths', async () => {
    const root = await fixture({
      'package-lock.json': '{"lockfileVersion":3}\n',
      'src/app.ts': 'export const value = 1;\n',
    });
    spawnSync('git', ['init', '-q'], { cwd: root });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root });
    spawnSync('git', ['add', '.'], { cwd: root });
    spawnSync('git', ['commit', '-qm', 'base'], { cwd: root });
    const provisioning = {
      lockfilePath: 'package-lock.json',
      command: [
        process.execPath,
        '-e',
        "require('fs').writeFileSync('.disposable/provisioned','ok')",
      ],
      writablePaths: ['.disposable'],
    };
    const git = new GitCandidateStore(root, 'release-workspace', [], provisioning);
    await git.initialize();
    const candidate = await git.snapshotStage('candidate');
    const workspace = await git.createQaWorkspace(candidate);

    expect(candidate.lockfile).toMatchObject({ path: 'package-lock.json' });
    expect(await readFile(resolve(workspace.path, '.disposable/provisioned'), 'utf8')).toBe('ok');
    expect(await git.verifyCandidateUnchanged(workspace, candidate)).toBe(true);
    await git.cleanupQaWorkspace(workspace);

    const invalid = new GitCandidateStore(root, 'release-workspace-invalid', [], {
      ...provisioning,
      command: [
        process.execPath,
        '-e',
        "require('fs').writeFileSync('outside.txt','not disposable')",
      ],
    });
    await invalid.initialize();
    const invalidCandidate = await invalid.snapshotStage('candidate');
    await expect(invalid.createQaWorkspace(invalidCandidate)).rejects.toThrow(
      'outside declared disposable paths',
    );
    await expect(access(resolve(invalid.runBase, 'qa'))).rejects.toThrow();
  });
});

/** @id TEST-AUTONOMOUS-AUTO-RELEASE-GATE-INVALIDATION-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-016
 */
describe('release gate cache invalidation', () => {
  it('TEST-AUTONOMOUS-AUTO-RELEASE-GATE-INVALIDATION-001 re-executes gates when the candidate or claim matrix digest changes', async () => {
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
      treeDigest: 'c'.repeat(40),
    };
    const current = await store.transition(created.id, 'candidate', 'test-candidate');
    current.candidate = candidate;
    current.iteration = 1;
    current.releaseGateBinding = {
      acceptedCandidateDigest: 'a'.repeat(40),
      claimMatrixDigest: 'b'.repeat(64),
      checkoutTreeDigest: 'a'.repeat(40),
    };
    current.releaseGateEvidence = [];
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
    const mandatoryChecks = vi.fn().mockResolvedValue(checks);
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

    expect(result.state).toBe('ready');
    expect(mandatoryChecks).toHaveBeenCalledTimes(1);
    expect(result.releaseGateBinding?.acceptedCandidateDigest).toBe(candidate.treeDigest);
    expect(result.releaseGateBinding?.claimMatrixDigest).not.toBe('b'.repeat(64));
  });
});
