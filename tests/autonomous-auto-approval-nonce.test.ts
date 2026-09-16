import { describe, expect, it, vi } from 'vitest';
import {
  autoApproveRunBoundary,
  FileRunStore,
  parseHohConfig,
} from '../packages/analysis/src/hoh.js';
import { fixture } from './helpers.js';

/** @id TEST-AUTONOMOUS-AUTO-APPROVAL-NONCE-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-016
 */
describe('automatic approval boundary nonce', () => {
  it('TEST-AUTONOMOUS-AUTO-APPROVAL-NONCE-001 issues a fresh nonce for each persisted boundary evaluation attempt', async () => {
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
        approval: {
          mode: 'verified-auto',
          boundaryAttemptLimit: 3,
          maxManifestBytes: 16_777_216,
          maxManifestPaths: 2_000,
        },
      }),
    });
    await store.enterAmendmentRequired(created.id, {
      candidate: { ref: 'refs/test/candidate', treeDigest: 'a'.repeat(40) },
      offendingPaths: ['musubix4 run'],
    });
    const paused = await store.prepareCollisionInventoryAmendment(created.id, 'replacement.json');
    const rejectedNonces: string[] = [];
    const invalidReviewer = vi.fn(async (context: unknown) => {
      const boundary = context as { nonce: string };
      rejectedNonces.push(boundary.nonce);
      return { nonce: 'invalid' };
    });

    await expect(autoApproveRunBoundary(store, paused.id, invalidReviewer))
      .rejects.toThrow(/Reviewer evidence retries exhausted/i);

    const validReviewer = vi.fn(async (context: unknown) => {
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
    const approved = await autoApproveRunBoundary(store, paused.id, validReviewer);
    const secondNonce = (validReviewer.mock.calls[0]?.[0] as { nonce: string }).nonce;

    expect(new Set(rejectedNonces)).toHaveSize(1);
    expect(secondNonce).not.toBe(rejectedNonces[0]);
    expect(approved.approval?.nonce).toBe(secondNonce);
  });
});
