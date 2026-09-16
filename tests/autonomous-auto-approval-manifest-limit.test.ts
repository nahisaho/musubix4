import { describe, expect, it, vi } from 'vitest';
import {
  autoApproveRunBoundary,
  FileRunStore,
  parseHohConfig,
} from '../packages/analysis/src/hoh.js';
import { fixture } from './helpers.js';

/** @id TEST-AUTONOMOUS-AUTO-APPROVAL-MANIFEST-LIMIT-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-016
 */
describe('automatic approval manifest limits', () => {
  it('TEST-AUTONOMOUS-AUTO-APPROVAL-MANIFEST-LIMIT-001 rejects oversized reviewed bytes before Reviewer invocation', async () => {
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
          maxManifestBytes: 1,
          maxManifestPaths: 2_000,
        },
      }),
    });
    await store.enterAmendmentRequired(created.id, {
      candidate: { ref: 'refs/test/candidate', treeDigest: 'a'.repeat(40) },
      offendingPaths: ['musubix4 run'],
    });
    const paused = await store.prepareCollisionInventoryAmendment(created.id, 'replacement.json');
    const reviewer = vi.fn();

    await expect(autoApproveRunBoundary(store, paused.id, reviewer))
      .rejects.toThrow(/manifest.*bytes/i);
    expect(reviewer).not.toHaveBeenCalled();
  });
});
