import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { recordWorkflow, runProcess } from '../packages/analysis/src/index.js';
import { repository } from './helpers.js';

function read(path: string): string {
  return readFileSync(resolve(repository, path), 'utf8')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');
}

function releaseMarkers(text: string, prefix: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.startsWith(prefix));
}

function skillPaths(): string[] {
  return readdirSync(resolve(repository, '.github/skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('sdd-'))
    .map((entry) => `.github/skills/${entry.name}/SKILL.md`)
    .sort();
}

function section(text: string, heading: string): string {
  const start = text.indexOf(heading);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = text.indexOf('\n## ', start + heading.length);
  return text.slice(start, end < 0 ? undefined : end);
}

/**
 * @id CODE-SAFE-WORKFLOW-SPEED-DOCS-003
 * @implements REQ-SAFE-WORKFLOW-SPEED-002
 * @design DES-SAFE-WORKFLOW-SPEED-003
 */
function anchoredParagraph(text: string, anchor: string): string {
  const start = text.indexOf(anchor);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = text.indexOf('\n\n', start);
  return text.slice(start, end < 0 ? undefined : end).replace(/\s+/g, ' ');
}

describe('v0.1.2 release documents', () => {
  /** @id TEST-SAFE-WORKFLOW-SPEED-003
   * @verifies REQ-SAFE-WORKFLOW-SPEED-002
   */
  it('TEST-SAFE-WORKFLOW-SPEED-003 documents safe parallel validation in both languages', () => {
    const englishAnchor = 'Only the explicitly allowlisted independent read-only validators';
    const japaneseAnchor = '明示的に許可された独立した読み取り専用validatorだけ';
    const englishSection = section(read('README.md'), '## Workflow');
    const japaneseSection = section(read('README-ja.md'), '## ワークフロー');
    expect(englishSection.split(englishAnchor)).toHaveLength(2);
    expect(japaneseSection.split(japaneseAnchor)).toHaveLength(2);

    const english = anchoredParagraph(englishSection, englishAnchor);
    const japanese = anchoredParagraph(japaneseSection, japaneseAnchor);
    const englishBoundary = english.split('all other commands remain sequential');
    const japaneseBoundary = japanese.split('その他のcommandはすべて逐次実行');
    expect(englishBoundary).toHaveLength(2);
    expect(japaneseBoundary).toHaveLength(2);
    const englishParallel = englishBoundary[0]!;
    const japaneseParallel = japaneseBoundary[0]!;
    const englishOrder = englishBoundary[1]!.split('The required order is:');
    const japaneseOrder = japaneseBoundary[1]!.split('requirements承認がdesignより先');
    expect(englishOrder).toHaveLength(2);
    expect(japaneseOrder).toHaveLength(2);
    const englishSequential = englishOrder[0]!;
    const japaneseSequential = japaneseOrder[0]!;
    const parallelCommands = [
      'requirements validate',
      'constitution validate',
      'design validate',
      'trace check',
      'config lint',
      'mutation validate',
      'model-correspondence validate',
      'approval validate',
    ];
    const sequentialCommands = [
      'trace build',
      'graph index',
      'knowledge build',
      'evidence refresh',
      'workflow-verify',
      'workflow-record',
      'status',
    ];
    for (const command of parallelCommands) {
      expect(englishParallel).toContain(`\`${command}\``);
      expect(japaneseParallel).toContain(`\`${command}\``);
    }
    for (const command of sequentialCommands) {
      expect(englishSequential).toContain(`\`${command}\``);
      expect(japaneseSequential).toContain(`\`${command}\``);
    }
    for (const phrase of [
      'all other commands remain sequential',
      'requirements approval precedes design',
      'design approval precedes Red',
      'Red precedes implementation',
      'implementation precedes Green',
      '`trace build` precedes trace consumers',
      '`graph index` precedes graph consumers',
    ]) {
      expect(english).toContain(phrase);
    }
    for (const phrase of [
      'その他のcommandはすべて逐次実行',
      'requirements承認がdesignより先',
      'design承認がRedより先',
      'Redがimplementationより先',
      'implementationがGreenより先',
      '`trace build`がtrace consumerより先',
      '`graph index`がgraph consumerより先',
    ]) {
      expect(japanese).toContain(phrase);
    }
  });

  /** @id TEST-RELEASE-V010-README-EN-001
   * @verifies REQ-RELEASE-V010-DOCS-001
   */
  it('TEST-RELEASE-V010-README-EN-001 verifies the English release entry point', () => {
    const text = read('README.md');
    const lines = text.split(/\r?\n/);
    expect(lines[0]).toBe('# musubix4');
    expect(lines.find((line, index) => index > 0 && line.trim()) ?? '').toMatch(/^\*\*Latest release v0\.1\.2 /);
    expect(releaseMarkers(text, '**Latest release v')).toEqual([
      expect.stringMatching(/^\*\*Latest release v0\.1\.2 /),
    ]);
    for (const token of [
      '## Why musubix4',
      '## Install',
      '## Workflow',
      '## Verification',
      '## Evidence reference',
      '## Limitations',
      'npm install --save-dev --save-exact musubix4@0.1.2',
      'npx --no-install musubix4 init',
      'copilot plugin install nahisaho/musubix4',
      'requirements validate',
      'design validate',
      'trace check --strict',
      'graph gate',
      'gate --changed',
      'approval prepare release',
      'The npm and repository/plugin commands become usable after v0.1.2 is published to the corresponding registry and repository.',
      '[日本語](README-ja.md)',
      '[Changelog](CHANGELOG.md)',
      '[License](LICENSE)',
    ]) {
      expect(text).toContain(token);
    }
    for (const token of [
      '--allow-unchanged',
      '`order`',
      '`recordedAt`',
      'TDD_REQUIREMENT_UNCOVERED',
      'workflow waiver record-all',
      'all-or-nothing',
      'WORKFLOW_INVOCATION_UNVERIFIED',
      'Attestation evidence-head composition',
    ]) {
      expect(section(text, '## Evidence reference')).toContain(token);
    }
    for (const token of [
      'musubix4 does not replace GitHub Copilot',
      'does not add another agent runtime',
      'does not treat SAT as proof of implementation correctness',
    ]) {
      expect(section(text, '## Limitations')).toContain(token);
    }
  });

  /** @id TEST-RELEASE-V010-README-JA-001
   * @verifies REQ-RELEASE-V010-DOCS-002
   */
  it('TEST-RELEASE-V010-README-JA-001 verifies the Japanese release entry point', () => {
    const text = read('README-ja.md');
    const lines = text.split(/\r?\n/);
    expect(lines[0]).toBe('# musubix4');
    expect(lines.find((line, index) => index > 0 && line.trim()) ?? '').toMatch(/^\*\*最新リリース v0\.1\.2 /);
    expect(releaseMarkers(text, '**最新リリース v')).toEqual([
      expect.stringMatching(/^\*\*最新リリース v0\.1\.2 /),
    ]);
    for (const token of [
      '## musubix4 が必要な理由',
      '## インストール',
      '## ワークフロー',
      '## 検証',
      '## 証拠リファレンス',
      '## 制限事項',
      'npm install --save-dev --save-exact musubix4@0.1.2',
      'npx --no-install musubix4 init',
      'copilot plugin install nahisaho/musubix4',
      'requirements validate',
      'design validate',
      'trace check --strict',
      'graph gate',
      'gate --changed',
      'approval prepare release',
      'npmおよびrepository/pluginコマンドは、v0.1.2が対応するregistryとrepositoryへ公開された後に利用可能になります。',
      '[English](README.md)',
      '[変更履歴](CHANGELOG.md)',
      '[ライセンス](LICENSE)',
    ]) {
      expect(text).toContain(token);
    }
    for (const token of [
      '--allow-unchanged',
      '`order`',
      '`recordedAt`',
      'TDD_REQUIREMENT_UNCOVERED',
      'workflow waiver record-all',
      'all-or-nothing',
      'WORKFLOW_INVOCATION_UNVERIFIED',
      'Attestation evidence-head composition',
    ]) {
      expect(section(text, '## 証拠リファレンス')).toContain(token);
    }
    for (const token of [
      'musubix4はGitHub Copilotを置き換えず',
      '別のagent runtimeを追加せず',
      'SATを実装の正しさの証明として扱いません',
    ]) {
      expect(section(text, '## 制限事項')).toContain(token);
    }
  });

  /** @id TEST-RELEASE-V010-SKILL-IDENTITY-001
   * @verifies REQ-RELEASE-V010-DOCS-005
   */
  it('TEST-RELEASE-V010-SKILL-IDENTITY-001 verifies every shipped Skill uses musubix4', () => {
    const paths = skillPaths();
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      const text = read(path);
      expect(text, path).not.toContain('musubix3');
      expect(text, path).toContain('musubix4');
    }
  });

  /** @id TEST-RELEASE-V010-NPX-IDENTITY-001
   * @verifies REQ-RELEASE-V010-DOCS-005
   */
  it('TEST-RELEASE-V010-NPX-IDENTITY-001 rejects non-musubix4 npx package arguments', async () => {
    const moduleUrl = new URL('../scripts/release-version.mjs', import.meta.url).href;
    const source = [
      `import { staleCommands } from ${JSON.stringify(moduleUrl)};`,
      "const cases = ['npx musubix3@0.1.18 init', 'npx -y musubix2 init', 'npx --no-install musubix4 init'];",
      "console.log(JSON.stringify(cases.map((value) => staleCommands('README.md', value))));",
    ].join('\n');
    const result = await runProcess(process.execPath, [
      '--input-type=module',
      '--eval',
      source,
    ], { cwd: repository, timeoutMs: 20_000 });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      ['npx musubix3@0.1.18'],
      ['npx -y musubix2'],
      [],
    ]);
  });

  /** @id TEST-RELEASE-V010-NPX-OPTIONS-001
   * @verifies REQ-RELEASE-V010-DOCS-005
   */
  it('TEST-RELEASE-V010-NPX-OPTIONS-001 rejects stale npx package option values', async () => {
    const moduleUrl = new URL('../scripts/release-version.mjs', import.meta.url).href;
    const source = [
      `import { staleCommands } from ${JSON.stringify(moduleUrl)};`,
      "const cases = ['npx --package=musubix2 other', 'npx -p musubix3@0.1.18 other', 'npx --package musubix4 other'];",
      "console.log(JSON.stringify(cases.map((value) => staleCommands('README.md', value))));",
    ].join('\n');
    const result = await runProcess(process.execPath, [
      '--input-type=module',
      '--eval',
      source,
    ], { cwd: repository, timeoutMs: 20_000 });

    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      ['npx --package=musubix2'],
      ['npx -p musubix3@0.1.18'],
      [],
    ]);
  });

  /** @id TEST-RELEASE-V010-WORKFLOW-VERSION-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-019
   */
  it('TEST-RELEASE-V010-WORKFLOW-VERSION-001 records the root package version independently of the evidence root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'musubix4-workflow-version-'));
    try {
      const expected = JSON.parse(read('package.json')).version;
      const workflow = await recordWorkflow(root, {
        skill: 'sdd-implementation',
        phase: 'complete',
        status: 'completed',
      });
      expect(workflow.events).toHaveLength(1);
      expect(workflow.events[0]?.version).toBe(expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /** @id TEST-RELEASE-V010-CHANGELOG-001
   * @verifies REQ-RELEASE-V010-DOCS-003
   */
  it('TEST-RELEASE-V010-CHANGELOG-001 verifies current and baseline changelog entries', () => {
    const text = read('CHANGELOG.md');
    const version = (JSON.parse(read('package.json')) as { version: string }).version;
    const releaseHeadings = text.split(/\r?\n/).filter((line) =>
      /^##\s+\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\s|$)/.test(line));
    expect(releaseHeadings).toHaveLength(2);
    expect(releaseHeadings[0]).toMatch(
      new RegExp(`^## ${version.replaceAll('.', '\\.')} - \\d{4}-\\d{2}-\\d{2}$`),
    );
    expect(releaseHeadings[1]).toBe('## 0.1.0 - 2026-09-16');
    expect(section(text, releaseHeadings[0]!)).toMatch(/\n### .+\n/);
    const baseline = section(text, releaseHeadings[1]!);
    const baselineParts = baseline.split('\n<!--', 2);
    expect(baselineParts).toHaveLength(2);
    const baselineHistory = baselineParts[0]!;
    const requirement = section(
      read('.musubix/features/release-v010-docs/requirements.md'),
      '## REQ-RELEASE-V010-DOCS-003:',
    );
    const approvedDigests = [
      ...requirement.matchAll(/SHA-256 `([a-f0-9]{64})`/g),
    ].map((match) => match[1]);
    expect(approvedDigests).toHaveLength(1);
    expect(createHash('sha256').update(baselineHistory).digest('hex'))
      .toBe(approvedDigests[0]);
    for (const token of [
      'Skills',
      'Deterministic evidence',
      'Distribution',
      'Limitations',
      'sdd-change',
      'requirements',
      'design',
      'trace',
      'TDD',
      'Code Graph',
      'formal',
      'quality gate',
      'npm',
      'GitHub Copilot CLI plugin',
    ]) {
      expect(baseline).toContain(token);
    }
  });

  /** @id TEST-RELEASE-V010-METADATA-001
   * @verifies REQ-RELEASE-V010-DOCS-004
   */
  it('TEST-RELEASE-V010-METADATA-001 verifies every governed metadata version', () => {
    const jsonPaths = [
      ['package.json', ['version']],
      ['packages/analysis/package.json', ['version']],
      ['packages/cli/package.json', ['version']],
      ['packages/domain/package.json', ['version']],
      ['plugin.json', ['version']],
      ['.github/plugin/marketplace.json', ['metadata.version', 'plugins.0.version']],
    ] as const;
    for (const [path, pointers] of jsonPaths) {
      const value = JSON.parse(read(path));
      for (const pointer of pointers) {
        const actual = pointer.split('.').reduce<unknown>(
          (current, key) => (current as Record<string, unknown>)[key],
          value,
        );
        expect(actual, `${path}#${pointer}`).toBe('0.1.2');
      }
    }
    const lock = JSON.parse(read('package-lock.json')) as {
      version: string;
      packages: Record<string, { version?: string }>;
    };
    expect(lock.version).toBe('0.1.2');
    for (const path of ['', 'packages/analysis', 'packages/cli', 'packages/domain']) {
      expect(lock.packages[path]?.version, `package-lock.json#packages/${path}/version`)
        .toBe('0.1.2');
    }
  });

  /** @id TEST-RELEASE-V010-BASELINE-001
   * @verifies REQ-AUTONOMOUS-DEVELOPMENT-019
   */
  it('TEST-RELEASE-V010-BASELINE-001 verifies the approved fixture and release verifier', async () => {
    const fixture = read('tests/fixtures/changelog-release-headings.json');
    expect(createHash('sha256').update(fixture).digest('hex')).toBe(
      'a3837f22d4057c6bf8f887ca379a11739ec48940ab5a47603f32ea4b0fa21926',
    );
    expect(JSON.parse(fixture)).toEqual({
      schemaVersion: 1,
      headings: ['## 0.1.0 - 2026-09-16'],
    });

    const result = await runProcess(process.execPath, [
      'scripts/release-version.mjs',
      '--root', repository,
      '--cli', resolve(repository, 'dist/packages/cli/src/main.js'),
      '--json',
    ], { cwd: repository, timeoutMs: 20_000 });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).version).toBe('0.1.2');
  });
});
