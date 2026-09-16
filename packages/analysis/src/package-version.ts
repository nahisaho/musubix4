import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** @id CODE-RELEASE-V010-DOCS-005
 * @implements REQ-AUTONOMOUS-DEVELOPMENT-019
 * @design DES-AUTONOMOUS-DEVELOPMENT-016 DES-RELEASE-V010-DOCS-004
 */
export function findPackageRoot(moduleUrl: string | URL): string {
  let directory = dirname(realpathSync(fileURLToPath(moduleUrl)));
  const inspected: string[] = [];
  for (let depth = 0; depth <= 8; depth += 1) {
    const packagePath = resolve(directory, 'package.json');
    inspected.push(packagePath);
    if (existsSync(packagePath)) {
      try {
        const value = JSON.parse(readFileSync(packagePath, 'utf8')) as { name?: unknown };
        if (value.name === 'musubix4') return directory;
      } catch {
        // Continue until the named root package is found.
      }
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`MUSUBIX4_VERSION_ROOT_NOT_FOUND: inspected ${inspected.join(', ')}`);
}

export function readPackageVersion(packagePath: string): string {
  let value: unknown;
  try {
    value = (JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: unknown }).version;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`MUSUBIX4_VERSION_INVALID: ${packagePath}: ${message}`);
  }
  if (typeof value !== 'string' || !PACKAGE_SEMVER.test(value)) {
    throw new Error(`MUSUBIX4_VERSION_INVALID: ${packagePath}: expected semantic version`);
  }
  return value;
}

export function currentPackageVersion(): string {
  return readPackageVersion(resolve(findPackageRoot(import.meta.url), 'package.json'));
}
