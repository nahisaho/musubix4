import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { recordWorkflow, runProcess } from '../packages/analysis/src/index.js';
import { repository } from './helpers.js';

function read(path: string): string {
  return readFileSync(resolve(repository, path), 'utf8');
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

describe('v0.1.0 release documents', () => {
  /** @id TEST-RELEASE-V010-README-EN-001
   * @verifies REQ-RELEASE-V010-DOCS-001
   */
  it('TEST-RELEASE-V010-README-EN-001 verifies the English release entry point', () => {
    const text = read('README.md');
    const lines = text.split(/\r?\n/);
    expect(lines[0]).toBe('# musubix4');
    expect(lines.find((line, index) => index > 0 && line.trim()) ?? '').toMatch(/^\*\*Latest release v0\.1\.0 /);
    expect(releaseMarkers(text, '**Latest release v')).toEqual([
      expect.stringMatching(/^\*\*Latest release v0\.1\.0 /),
    ]);
    for (const token of [
      '## Why musubix4',
      '## Install',
      '## Workflow',
      '## Verification',
      '## Evidence reference',
      '## Limitations',
      'npm install --save-dev --save-exact musubix4@0.1.0',
      'npx --no-install musubix4 init',
      'copilot plugin install nahisaho/musubix4',
      'requirements validate',
      'design validate',
      'trace check --strict',
      'graph gate',
      'gate --changed',
      'approval prepare release',
      'The npm and repository/plugin commands become usable after v0.1.0 is published to the corresponding registry and repository.',
      '--allow-unchanged',
      '`order`',
      '`recordedAt`',
      'TDD_REQUIREMENT_UNCOVERED',
      'workflow waiver record-all',
      'all-or-nothing',
      'WORKFLOW_INVOCATION_UNVERIFIED',
      'Attestation evidence-head composition',
      'musubix4 does not replace GitHub Copilot',
      'does not add another agent runtime',
      'does not treat SAT as proof of implementation correctness',
      '[日本語](README-ja.md)',
      '[Changelog](CHANGELOG.md)',
      '[License](LICENSE)',
    ]) {
      expect(text).toContain(token);
    }
  });

  /** @id TEST-RELEASE-V010-README-JA-001
   * @verifies REQ-RELEASE-V010-DOCS-002
   */
  it('TEST-RELEASE-V010-README-JA-001 verifies the Japanese release entry point', () => {
    const text = read('README-ja.md');
    const lines = text.split(/\r?\n/);
    expect(lines[0]).toBe('# musubix4');
    expect(lines.find((line, index) => index > 0 && line.trim()) ?? '').toMatch(/^\*\*最新リリース v0\.1\.0 /);
    expect(releaseMarkers(text, '**最新リリース v')).toEqual([
      expect.stringMatching(/^\*\*最新リリース v0\.1\.0 /),
    ]);
    for (const token of [
      '## musubix4 が必要な理由',
      '## インストール',
      '## ワークフロー',
      '## 検証',
      '## 証拠リファレンス',
      '## 制限事項',
      'npm install --save-dev --save-exact musubix4@0.1.0',
      'npx --no-install musubix4 init',
      'copilot plugin install nahisaho/musubix4',
      'requirements validate',
      'design validate',
      'trace check --strict',
      'graph gate',
      'gate --changed',
      'approval prepare release',
      'npmおよびrepository/pluginコマンドは、v0.1.0が対応するregistryとrepositoryへ公開された後に利用可能になります。',
      '--allow-unchanged',
      '`order`',
      '`recordedAt`',
      'TDD_REQUIREMENT_UNCOVERED',
      'workflow waiver record-all',
      'all-or-nothing',
      'WORKFLOW_INVOCATION_UNVERIFIED',
      'Attestation evidence-head composition',
      'musubix4はGitHub Copilotを置き換えず',
      '別のagent runtimeを追加せず',
      'SATを実装の正しさの証明として扱いません',
      '[English](README.md)',
      '[変更履歴](CHANGELOG.md)',
      '[ライセンス](LICENSE)',
    ]) {
      expect(text).toContain(token);
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
  it('TEST-RELEASE-V010-CHANGELOG-001 verifies the initial changelog baseline', () => {
    const text = read('CHANGELOG.md');
    const releaseHeadings = text.split(/\r?\n/).filter((line) =>
      /^##\s+\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\s|$)/.test(line));
    expect(releaseHeadings).toEqual(['## 0.1.0 - 2026-09-16']);
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
      expect(text).toContain(token);
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
        expect(actual, `${path}#${pointer}`).toBe('0.1.0');
      }
    }
    expect(read('package-lock.json')).not.toContain('"version": "0.1.18"');
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
    expect(JSON.parse(result.stdout).version).toBe('0.1.0');
  });
});
