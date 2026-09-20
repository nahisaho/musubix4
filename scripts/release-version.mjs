import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { t as listTar } from 'tar';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const FULL_SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const RELEASE_HEADING = /^##\s+(\d+\.\d+\.\d+)(?:\s+-\s+.+)?$/;
const DATED_RELEASE_HEADING = /^##\s+(\d+\.\d+\.\d+)\s+-\s+\S.+$/;
const ANY_RELEASE_HEADING = /^##\s+\d+\.\d+\.\d+(?:-[^ ]+)?(?:\s+-\s+.*)?$/;
const EXACT_RELEASE_HEADING = /^##\s+(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s+-\s+(\d{4}-\d{2}-\d{2})$/;
const ENTRY_LIMIT = 1_048_576;
const TOTAL_LIMIT = 16_777_216;
const ARCHIVE_PATHS = [
  'package/package.json',
  'package/plugin.json',
  'package/.github/plugin/marketplace.json',
  'package/README.md',
  'package/README-ja.md',
  'package/CHANGELOG.md',
];

/** @id CODE-RELEASE-VERSION-002
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-019
 * @design DES-AUTONOMOUS-DEVELOPMENT-016
 */
export function canonicalText(value) {
  return value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function readText(root, path) {
  return canonicalText(readFileSync(resolve(root, path), 'utf8'));
}

function readJson(root, path) {
  return JSON.parse(readText(root, path));
}

function decodeText(content) {
  if (content.includes(0)) return undefined;
  try {
    return canonicalText(new TextDecoder('utf-8', { fatal: true }).decode(content));
  } catch {
    return undefined;
  }
}

const NPX_OPTIONS_WITH_VALUES = new Set([
  '-c',
  '--call',
  '--cache',
  '--shell',
  '--userconfig',
]);
const NPX_PACKAGE_OPTIONS = new Set(['-p', '--package']);

function unquoteToken(token) {
  if ((token.startsWith('"') && token.endsWith('"'))
    || (token.startsWith("'") && token.endsWith("'"))) {
    return token.slice(1, -1);
  }
  return token;
}

function npxPackageName(token) {
  const value = unquoteToken(token);
  const versionIndex = value.indexOf('@', 1);
  return versionIndex < 0 ? value : value.slice(0, versionIndex);
}

function staleNpxCommands(text) {
  const matches = [];
  for (const command of text.matchAll(/\bnpx\b([^\r\n;&|`]*)/gm)) {
    const args = command[1] ?? '';
    const tokens = [...args.matchAll(/"[^"]*"|'[^']*'|[^\s]+/g)];
    const inspect = (token, packageValue = token[0]) => {
      const packageName = npxPackageName(packageValue);
      if (packageName.startsWith('musubix') && packageName !== 'musubix4') {
        const end = 'npx'.length + (token.index ?? 0) + token[0].length;
        matches.push(command[0].slice(0, end));
      }
    };
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index]?.[0];
      if (!token) continue;
      if (token === '--') {
        index += 1;
      } else if (token.startsWith('--package=') || token.startsWith('-p=')) {
        inspect(tokens[index], token.slice(token.indexOf('=') + 1));
        continue;
      } else if (NPX_PACKAGE_OPTIONS.has(token)) {
        index += 1;
        const packageToken = tokens[index];
        if (packageToken) inspect(packageToken);
        continue;
      } else if (token.startsWith('-')) {
        if (NPX_OPTIONS_WITH_VALUES.has(token)) index += 1;
        continue;
      }
      const packageToken = tokens[index];
      if (!packageToken) break;
      inspect(packageToken);
      break;
    }
  }
  return matches;
}

export function staleCommands(path, text) {
  const matches = [];
  matches.push(...staleNpxCommands(text));
  if (path.endsWith('.md')) {
    for (const match of text.matchAll(/`([^`\n]+)`/g)) {
      if (/^\s*musubix3(?:\s|$)/.test(match[1])) matches.push(match[0]);
    }
    let fenced = false;
    for (const line of text.split('\n')) {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
      } else if (fenced && /(?:^|;|&&|\|\|)\s*musubix3(?:\s|$)/.test(line)) {
        matches.push(line);
      }
    }
  }
  return matches;
}

function collectFiles(path) {
  const status = statSync(path);
  if (status.isFile()) return [path];
  assert(status.isDirectory(), `Configured package path is not a file or directory: ${path}`);
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    collectFiles(resolve(path, entry.name)));
}

/** @id CODE-RELEASE-V010-DOCS-006
 * @implements REQ-RELEASE-V010-DOCS-005
 * @design DES-RELEASE-V010-DOCS-004
 */
export function verifyRepositoryProductIdentity(root, pkg) {
  assert(Array.isArray(pkg.files) && pkg.files.every((entry) => typeof entry === 'string'),
    'package.json /files must be an array of paths');
  const files = [];
  for (const entry of pkg.files) {
    const path = resolve(root, entry);
    if (!existsSync(path)) {
      assert.equal(entry, 'dist', `Configured package path is missing: ${entry}`);
      continue;
    }
    files.push(...collectFiles(path));
  }
  const relativeFiles = files.map((path) => posix.normalize(path.slice(root.length + 1).replaceAll('\\', '/')));
  const skills = relativeFiles.filter((path) => /^\.github\/skills\/sdd-[^/]+\/SKILL\.md$/.test(path));
  assert(skills.length > 0, 'Package file scan found no SDD Skills');
  for (const required of [
    'README.md',
    'README-ja.md',
    'plugin.json',
    '.github/plugin/marketplace.json',
    ...skills,
  ]) assert(relativeFiles.includes(required), `Package file scan is missing ${required}`);
  for (let index = 0; index < files.length; index += 1) {
    const path = relativeFiles[index];
    assert(path, 'Package file scan produced an invalid path');
    const content = readFileSync(files[index]);
    const text = decodeText(content);
    if (text === undefined) continue;
    if (skills.includes(path)) assert(!text.includes('musubix3'), `${path} contains musubix3`);
    const matches = staleCommands(path, text);
    assert.equal(matches.length, 0, `${path} contains stale command: ${matches[0] ?? ''}`);
  }
}

function workspacePatterns(pkg) {
  const value = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages;
  assert(Array.isArray(value) && value.every((entry) => typeof entry === 'string'),
    'package.json /workspaces must be an array of paths');
  return value;
}

function expandWorkspaces(root, patterns) {
  const result = new Set();
  for (const pattern of patterns) {
    const normalized = posix.normalize(pattern.replaceAll('\\', '/'));
    assert(!normalized.startsWith('../') && !normalized.startsWith('/'),
      `package.json has unsafe workspace pattern ${pattern}`);
    if (!normalized.includes('*')) {
      result.add(normalized);
      continue;
    }
    assert(normalized.endsWith('/*') && normalized.indexOf('*') === normalized.length - 1,
      `Unsupported workspace pattern ${pattern}`);
    const parent = normalized.slice(0, -2);
    for (const entry of readdirSync(resolve(root, parent), { withFileTypes: true })) {
      if (entry.isDirectory()) result.add(`${parent}/${entry.name}`);
    }
  }
  return [...result].filter((path) => {
    try {
      const manifest = readJson(root, `${path}/package.json`);
      return typeof manifest.name === 'string';
    } catch {
      return false;
    }
  }).sort();
}

function compareVersion(actual, expected, path) {
  assert.equal(actual, expected, `${path} version ${String(actual)} does not match ${expected}`);
}

function compareStableVersions(left, right) {
  const a = SEMVER.exec(left);
  const b = SEMVER.exec(right);
  assert(a && b, `Expected stable semantic versions, received ${left} and ${right}`);
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(b[index]) - Number(a[index]);
    if (difference !== 0) return difference;
  }
  return 0;
}

function releaseHeadings(changelog) {
  return changelog.split('\n').filter((line) => ANY_RELEASE_HEADING.test(line));
}

function compareSemanticVersions(left, right) {
  const a = FULL_SEMVER.exec(left);
  const b = FULL_SEMVER.exec(right);
  assert(a && b, `Expected semantic versions, received ${left} and ${right}`);
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(a[index]) - Number(b[index]);
    if (difference !== 0) return difference;
  }
  const leftPre = a[4];
  const rightPre = b[4];
  if (leftPre === undefined) return rightPre === undefined ? 0 : 1;
  if (rightPre === undefined) return -1;
  const leftParts = leftPre.split('.');
  const rightParts = rightPre.split('.');
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) - Number(rightPart);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

/** @id CODE-RELEASE-CHRONOLOGY-019
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-019
 * @design DES-AUTONOMOUS-DEVELOPMENT-019 DES-RELEASE-V010-DOCS-005
 */
export function validateReleaseHeadings(headings, version, fixture) {
  assert(headings.length > 0, 'CHANGELOG.md has no semantic-version release headings');
  assert(fixture.length > 0, 'Approved CHANGELOG heading fixture must not be empty');
  assert.deepEqual(headings.slice(-fixture.length), fixture,
    'Approved CHANGELOG headings must remain the contiguous trailing block');
  const parsed = headings.map((heading) => {
    const match = EXACT_RELEASE_HEADING.exec(heading);
    assert(match, `CHANGELOG.md release heading must contain a valid semantic version and YYYY-MM-DD date: ${heading}`);
    const date = new Date(`${match[2]}T00:00:00.000Z`);
    assert(!Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === match[2],
      `CHANGELOG.md release heading has an invalid date: ${heading}`);
    return { heading, version: match[1], date: match[2] };
  });
  assert.equal(parsed[0].version, version,
    `CHANGELOG.md first release heading version ${parsed[0].version} does not match ${version}`);
  assert.equal(FULL_SEMVER.exec(version)?.[4], undefined,
    'CHANGELOG.md first release heading must be a stable version');
  const seen = new Set();
  for (const entry of parsed) {
    assert(!seen.has(entry.version), `CHANGELOG.md has duplicate release version ${entry.version}`);
    seen.add(entry.version);
  }
  for (let index = 0; index < parsed.length - 1; index += 1) {
    const upper = parsed[index];
    const lower = parsed[index + 1];
    assert(compareSemanticVersions(upper.version, lower.version) > 0,
      `CHANGELOG.md release version ${upper.version} must be newer than ${lower.version}`);
    assert(upper.date >= lower.date,
      `CHANGELOG.md release date ${upper.date} for ${upper.version} must not be earlier than ${lower.date} for ${lower.version}`);
  }
  const baseline = parsed.at(-1);
  assert.equal(baseline?.heading, '## 0.1.0 - 2026-09-16',
    'CHANGELOG.md immutable baseline must be the trailing release heading');
  for (const entry of parsed.slice(0, -1)) {
    assert(entry.date > '2026-09-16',
      `CHANGELOG.md post-baseline release ${entry.version} must be later than 2026-09-16`);
  }
  return parsed;
}

function approvedFixtureDigest(requirements) {
  const block = requirements.match(
    /## REQ-AUTONOMOUS-DEVELOPMENT-019:[\s\S]*?(?=\n## REQ-|\s*$)/,
  )?.[0];
  assert(block, 'REQ-AUTONOMOUS-DEVELOPMENT-019 is missing');
  const collapsed = block.replace(/\s+/g, ' ');
  const matches = [...collapsed.matchAll(
    /`tests\/fixtures\/changelog-release-headings\.json`, SHA-256 `([0-9a-f]{64})`(?![0-9a-f])/g,
  )];
  assert.equal(matches.length, 1, 'REQ-AUTONOMOUS-DEVELOPMENT-019 must contain exactly one fixture SHA-256');
  return matches[0][1];
}

/** @id CODE-RELEASE-V010-DOCS-004
 * @implements REQ-RELEASE-V010-DOCS-001 REQ-RELEASE-V010-DOCS-002 REQ-RELEASE-V010-DOCS-003 REQ-RELEASE-V010-DOCS-004
 * @design DES-RELEASE-V010-DOCS-001 DES-RELEASE-V010-DOCS-002 DES-RELEASE-V010-DOCS-003
 */
function verifyDocuments(version, read) {
  const requirements = read('.musubix/features/autonomous-development/requirements.md');
  const fixtureText = read('tests/fixtures/changelog-release-headings.json');
  const fixtureDigest = createHash('sha256').update(fixtureText).digest('hex');
  assert.equal(fixtureDigest, approvedFixtureDigest(requirements),
    'tests/fixtures/changelog-release-headings.json digest does not match REQ-AUTONOMOUS-DEVELOPMENT-019');
  const fixture = JSON.parse(fixtureText).headings;
  assert(Array.isArray(fixture) && fixture.every((heading) => typeof heading === 'string'),
    'CHANGELOG heading fixture is invalid');

  const changelog = read('CHANGELOG.md');
  const headings = releaseHeadings(changelog);
  validateReleaseHeadings(headings, version, fixture);

  const readme = read('README.md');
  const readmeJa = read('README-ja.md');
  assert(readme.includes(`**Latest release v${version} `), 'README.md latest release marker is stale');
  assert(readmeJa.includes(`**最新リリース v${version} `), 'README-ja.md latest release marker is stale');
}

export function verifyRepositoryReleaseVersions(root, cliEntry) {
  const pkg = readJson(root, 'package.json');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/,
    'package.json /version must be a stable semantic version for release verification');
  const version = pkg.version;
  verifyRepositoryProductIdentity(root, pkg);
  const workspaces = expandWorkspaces(root, workspacePatterns(pkg));
  const lock = readJson(root, 'package-lock.json');
  compareVersion(lock.version, version, 'package-lock.json /version');
  compareVersion(lock.packages?.['']?.version, version, 'package-lock.json /packages//version');

  const lockWorkspaces = Object.entries(lock.packages ?? {})
    .filter(([path, entry]) =>
      path !== '' && !path.startsWith('node_modules/') && typeof entry?.version === 'string')
    .map(([path]) => path)
    .sort();
  assert.deepEqual(lockWorkspaces, workspaces, 'Workspace manifest and lockfile path sets differ');
  for (const workspace of workspaces) {
    compareVersion(readJson(root, `${workspace}/package.json`).version, version,
      `${workspace}/package.json /version`);
    compareVersion(lock.packages[workspace].version, version,
      `package-lock.json /packages/${workspace.replaceAll('/', '~1')}/version`);
  }

  compareVersion(readJson(root, 'plugin.json').version, version, 'plugin.json /version');
  const marketplace = readJson(root, '.github/plugin/marketplace.json');
  compareVersion(marketplace.metadata?.version, version, 'marketplace.json /metadata/version');
  const plugins = marketplace.plugins?.filter((plugin) => plugin.name === 'musubix4') ?? [];
  assert.equal(plugins.length, 1, 'marketplace.json must contain exactly one musubix4 plugin');
  compareVersion(plugins[0].version, version, 'marketplace.json musubix4 /version');

  verifyDocuments(version, (path) => readText(root, path));
  const cliVersion = execFileSync(process.execPath, [cliEntry, '--version'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  compareVersion(cliVersion, version, `${cliEntry} --version`);
  return { version, workspaces };
}

async function readPackedTextEntries(tarball, paths) {
  const wanted = new Set(paths);
  const values = new Map();
  const seen = new Set();
  const reads = [];
  let total = 0;
  await listTar({
    file: tarball,
    onentry(entry) {
      const rawPath = entry.path.replaceAll('\\', '/');
      const normalized = posix.normalize(rawPath);
      if (entry.type !== 'File') {
        entry.resume();
        return;
      }
      reads.push((async () => {
        assert.equal(rawPath, normalized, `Archive target has unsafe path ${rawPath}`);
        assert(!seen.has(normalized), `Archive contains duplicate file ${normalized}`);
        seen.add(normalized);
        assert(entry.size <= ENTRY_LIMIT, `Archive file exceeds ${ENTRY_LIMIT} bytes: ${normalized}`);
        const content = await entry.concat();
        total += content.length;
        assert(total <= TOTAL_LIMIT, `Archive text scan exceeds ${TOTAL_LIMIT} bytes at ${normalized}`);
        const text = decodeText(content);
        if (text !== undefined) {
          const path = normalized.startsWith('package/') ? normalized.slice('package/'.length) : normalized;
          const matches = staleCommands(path, text);
          assert.equal(matches.length, 0, `Archive ${normalized} contains stale command: ${matches[0] ?? ''}`);
          if (wanted.has(normalized)) values.set(normalized, text);
        } else {
          assert(!wanted.has(normalized), `Archive target is not UTF-8 text: ${normalized}`);
        }
      })());
    },
  });
  await Promise.all(reads);
  for (const path of wanted) assert(values.has(path), `Package is missing ${path}`);
  return values;
}

export async function verifyPackedReleaseVersions(tarball, expectedVersion) {
  const values = await readPackedTextEntries(tarball, ARCHIVE_PATHS);
  const read = (path) => values.get(`package/${path}`);
  compareVersion(JSON.parse(read('package.json')).version, expectedVersion, 'packed package.json /version');
  compareVersion(JSON.parse(read('plugin.json')).version, expectedVersion, 'packed plugin.json /version');
  const marketplace = JSON.parse(read('.github/plugin/marketplace.json'));
  compareVersion(marketplace.metadata?.version, expectedVersion, 'packed marketplace /metadata/version');
  const plugins = marketplace.plugins?.filter((plugin) => plugin.name === 'musubix4') ?? [];
  assert.equal(plugins.length, 1, 'packed marketplace must contain exactly one musubix4 plugin');
  compareVersion(plugins[0].version, expectedVersion, 'packed marketplace musubix4 /version');
  const readme = read('README.md');
  const readmeJa = read('README-ja.md');
  const changelog = read('CHANGELOG.md');
  assert(readme.includes(`**Latest release v${expectedVersion} `), 'packed README.md marker is stale');
  assert(readmeJa.includes(`**最新リリース v${expectedVersion} `), 'packed README-ja.md marker is stale');
  validateReleaseHeadings(
    releaseHeadings(changelog),
    expectedVersion,
    ['## 0.1.0 - 2026-09-16'],
  );
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = resolve(argument('--root', '.'));
    const cli = resolve(argument('--cli', resolve(root, 'dist/packages/cli/src/main.js')));
    const report = verifyRepositoryReleaseVersions(root, cli);
    console.log(process.argv.includes('--json') ? JSON.stringify(report) : `Release version ${report.version} verified.`);
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause));
    process.exitCode = 1;
  }
}
