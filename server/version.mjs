import {readFileSync} from 'node:fs';
import {execSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pkg = {version: '0.0.0'};
try { pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')); } catch {}

export function gitCommit() {
  if (process.env.NOVA_GIT_COMMIT) return String(process.env.NOVA_GIT_COMMIT).trim().slice(0, 40);
  try {
    return execSync('git rev-parse HEAD', {cwd: ROOT, encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore']}).trim().slice(0, 40);
  } catch {
    try {
      const head = readFileSync(join(ROOT, '.git/HEAD'), 'utf8').trim();
      if (head.startsWith('ref: ')) {
        return readFileSync(join(ROOT, '.git', head.slice(4).trim()), 'utf8').trim().slice(0, 40);
      }
      return head.slice(0, 40);
    } catch { return null; }
  }
}

export function appVersion() {
  return {
    version: pkg.version,
    commit: gitCommit(),
    node: process.version,
    builtAt: process.env.NOVA_BUILT_AT || null,
  };
}
