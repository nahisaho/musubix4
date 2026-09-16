import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  autoApproveRunBoundary,
  FileRunStore,
  parseHohConfig,
} from '../packages/analysis/src/hoh.js';
import { fixture } from './helpers.js';

/** @id TEST-AUTONOMOUS-AUTO-APPROVAL-REHASH-001
 * @verifies REQ-AUTONOMOUS-DEVELOPMENT-016
 */
describe('automatic approval decision-time rehash', () => {
  it('TEST-AUTONOMOUS-AUTO-APPROVAL-REHASH-001 rejects changed amendment bytes before Reviewer invocation or attempt consumption', async () => {
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
    await writeFile(resolve(root, 'replacement.json'), '{"schemaVersion":1,"entries":[{"path":"run"}]}\n');
    const reviewer = vi.fn();

    await expect(autoApproveRunBoundary(store, paused.id, reviewer))
      .rejects.toThrow(/manifest.*digest|changed.*bytes/i);

    expect(reviewer).not.toHaveBeenCalled();
    expect((await store.status(paused.id)).approvalAttempts).toBeUndefined();
  });
});
