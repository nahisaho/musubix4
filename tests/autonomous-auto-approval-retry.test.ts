import { describe, expect, it, vi } from 'vitest';
import {
  autoApproveRunBoundary,
  FileRunStore,
  parseHohConfig,
} from '../packages/analysis/src/hoh.js';
import { fixture } from './helpers.js';

/** @id TEST-AUTONOMOUS-AUTO-APPROVAL-RETRY-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-016
 */
describe('automatic approval retries', () => {
  it('TEST-AUTONOMOUS-AUTO-APPROVAL-RETRY-001 retries inadmissible Reviewer evidence within the fixed boundary limit', async () => {
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
        approval: { mode: 'verified-auto', boundaryAttemptLimit: 3 },
      }),
    });
    await store.enterAmendmentRequired(created.id, {
      candidate: { ref: 'refs/test/candidate', treeDigest: 'a'.repeat(40) },
      offendingPaths: ['musubix4 run'],
    });
    const paused = await store.prepareCollisionInventoryAmendment(created.id, 'replacement.json');
    const reviewer = vi.fn()
      .mockResolvedValueOnce({ findings: [{ path: 'replacement.json', rule: 'REQ-016' }] })
      .mockResolvedValueOnce({ findings: [{ path: 'replacement.json', rule: 'REQ-016' }] })
      .mockImplementation(async (context: unknown) => {
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

    const approved = await autoApproveRunBoundary(store, paused.id, reviewer);

    expect(reviewer).toHaveBeenCalledTimes(3);
    expect(approved.approval).toMatchObject({ decision: 'approved', automated: true });
  });
});
