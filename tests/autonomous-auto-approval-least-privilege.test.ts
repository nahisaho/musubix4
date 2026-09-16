import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  autoApproveRunBoundary,
  FileRunStore,
  parseHohConfig,
} from '../packages/analysis/src/hoh.js';
import { fixture } from './helpers.js';

/** @id TEST-AUTONOMOUS-AUTO-APPROVAL-LEAST-PRIVILEGE-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-016
 */
describe('automatic approval Reviewer least privilege', () => {
  it('TEST-AUTONOMOUS-AUTO-APPROVAL-LEAST-PRIVILEGE-001 sends only canonical amendment artifacts instead of the RunRecord', async () => {
    const bytes = '{"schemaVersion":1,"entries":[]}\n';
    const root = await fixture({ 'replacement.json': bytes });
    const store = new FileRunStore(root);
    const created = await store.create({
      source: { kind: 'prompt', text: 'Build safely' },
      config: parseHohConfig({
        model: 'gpt-5.4',
        budget: { aiCredits: 10 },
        commands: { test: ['npm', 'test'] },
      }),
    });
    await store.enterAmendmentRequired(created.id, {
      candidate: { ref: 'refs/test/candidate', treeDigest: 'a'.repeat(40) },
      offendingPaths: ['musubix4 run'],
    });
    const paused = await store.prepareCollisionInventoryAmendment(created.id, 'replacement.json');
    const reviewer = vi.fn(async (context: unknown) => {
      expect(context).not.toHaveProperty('run');
      const boundary = context as {
        stage: string;
        boundaryKind: string;
        boundaryEpisodeOrdinal: number;
        amendmentAttemptOrdinal: number;
        nonce: string;
        manifestDigest: string;
        manifestPaths: string[];
        manifestArtifacts: Array<{ path: string; sha256: string; bytes: string }>;
      };
      expect(boundary.manifestArtifacts).toEqual([{
        path: 'replacement.json',
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes,
      }]);
      return {
        stage: boundary.stage,
        boundaryKind: boundary.boundaryKind,
        boundaryEpisodeOrdinal: boundary.boundaryEpisodeOrdinal,
        amendmentAttemptOrdinal: boundary.amendmentAttemptOrdinal,
        nonce: boundary.nonce,
        manifestDigest: boundary.manifestDigest,
        reviewedPaths: boundary.manifestPaths,
        findings: [],
      };
    });

    const approved = await autoApproveRunBoundary(store, paused.id, reviewer);

    expect(approved.approval).toMatchObject({ decision: 'approved', automated: true });
  });
});
