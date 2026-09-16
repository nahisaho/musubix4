import { describe, expect, it, vi } from 'vitest';
import {
  autoApproveRunBoundary,
  FileRunStore,
  parseHohConfig,
} from '../packages/analysis/src/hoh.js';
import { fixture } from './helpers.js';

/** @id TEST-AUTONOMOUS-AUTO-AMENDMENT-REPAIR-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-016
 */
describe('automatic amendment approval repair', () => {
  it('TEST-AUTONOMOUS-AUTO-AMENDMENT-REPAIR-001 keeps the amendment boundary retryable while attempts remain', async () => {
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
        approval: { mode: 'verified-auto', boundaryAttemptLimit: 2 },
      }),
    });
    await store.enterAmendmentRequired(created.id, {
      candidate: { ref: 'refs/test/candidate', treeDigest: 'a'.repeat(40) },
      offendingPaths: ['musubix4 run'],
    });
    const paused = await store.prepareCollisionInventoryAmendment(created.id, 'replacement.json');
    const invalidReviewer = vi.fn(async () => ({ findings: [] }));

    const repair = await autoApproveRunBoundary(store, paused.id, invalidReviewer);

    expect(repair.state).toBe('approval-paused');
    expect(repair.journal.at(-1)?.event).toBe('approval-repair-required');
    expect(repair.amendmentManifest).toEqual(paused.amendmentManifest);

    const reviewer = vi.fn(async (context: unknown) => {
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

    expect(approved.state).toBe('amendment-required');
    expect(approved.approval).toMatchObject({
      stage: 'requirements',
      decision: 'approved',
      automated: true,
    });
  });
});
