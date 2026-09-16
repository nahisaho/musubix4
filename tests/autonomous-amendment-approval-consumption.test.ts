import { describe, expect, it, vi } from 'vitest';
import {
  autoApproveRunBoundary,
  FileRunStore,
  parseHohConfig,
} from '../packages/analysis/src/hoh.js';
import { fixture } from './helpers.js';

/** @id TEST-AUTONOMOUS-AMENDMENT-APPROVAL-CONSUMPTION-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-016
 */
describe('amendment approval consumption', () => {
  it('TEST-AUTONOMOUS-AMENDMENT-APPROVAL-CONSUMPTION-001 clears consumed authority after a post-approval failure', async () => {
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
      }),
    });
    await store.enterAmendmentRequired(created.id, {
      candidate: { ref: 'refs/test/candidate', treeDigest: 'a'.repeat(40) },
      offendingPaths: ['musubix4 run'],
    });
    const paused = await store.prepareCollisionInventoryAmendment(created.id, 'replacement.json');
    await autoApproveRunBoundary(store, paused.id, async (context: unknown) => {
      const boundary = context as {
        stage: string;
        boundaryKind: string;
        boundaryEpisodeOrdinal: number;
        amendmentAttemptOrdinal: number;
        nonce: string;
        manifestDigest: string;
        manifestPaths: string[];
      };
      return {
        ...boundary,
        reviewedPaths: boundary.manifestPaths,
        findings: [],
      };
    });

    const failed = await store.recordAmendmentFailure(paused.id, 'AMENDMENT_PROMOTION_FAILED');
    const reviewer = vi.fn();

    expect(failed).toMatchObject({
      state: 'amendment-required',
      amendmentFailureCount: 1,
      requiredOperatorAction: 'amend-collision-inventory',
    });
    expect(failed.approval).toBeUndefined();
    expect(failed.amendmentManifest).toBeUndefined();
    await expect(autoApproveRunBoundary(store, paused.id, reviewer))
      .rejects.toThrow(/not paused/i);
    expect(reviewer).not.toHaveBeenCalled();
  });
});
