import { describe, expect, it, vi } from 'vitest';
import {
  autoApproveRunBoundary,
  FileRunStore,
  parseHohConfig,
} from '../packages/analysis/src/hoh.js';
import { fixture } from './helpers.js';

/** @id TEST-AUTONOMOUS-AUTO-AMENDMENT-APPROVAL-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-016
 */
describe('verified automatic amendment approval', () => {
  it('TEST-AUTONOMOUS-AUTO-AMENDMENT-APPROVAL-001 approves exact replacement bytes without a human record', async () => {
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
      return {
        ...boundary,
        reviewedPaths: boundary.manifestPaths,
        findings: [],
      };
    });

    const approved = await autoApproveRunBoundary(store, paused.id, reviewer);

    expect(reviewer).toHaveBeenCalledTimes(1);
    expect(approved).toMatchObject({
      state: 'amendment-required',
      requiredOperatorAction: 'amend-collision-inventory',
      approval: {
        stage: 'requirements',
        decision: 'approved',
        automated: true,
      },
    });
  });
});
