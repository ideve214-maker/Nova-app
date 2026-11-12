#!/usr/bin/env node
// SQLite 一致性备份（VACUUM INTO）与恢复。用法见 --help。
import {readdirSync, statSync, unlinkSync, existsSync, mkdirSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {backupTo, restoreFrom} from '../server/backup.mjs';

function arg(name, fallback) {
  const eq = process.argv.find(a => a.startsWith('--' + name + '='));
  if (eq) return eq.slice(name.length + 3);
  const i = process.argv.indexOf('--' + name);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('-')) return process.argv[i + 1];
  return fallback;
}
function has(flag) { return process.argv.includes('--' + flag) || process.argv.includes('-' + flag); }

const cmd = (process.argv[2] === 'restore' || process.argv[2] === 'backup') ? process.argv[2]
  : (has('restore') ? 'restore' : 'backup');

const db = resolve(arg('db', process.env.NOVA_DB || './nova.db'));
const dir = resolve(arg('dir', process.env.NOVA_BACKUP_DIR || './backups'));
const keep = Math.max(1, Number(arg('keep', process.env.NOVA_BACKUP_KEEP || '14')) || 14);

if (has('help') || process.argv[2] === '--help') {
  console.log(`用法：
  node scripts/backup.mjs backup [--db 路径] [--dir 目录] [--keep N]
  node scripts/backup.mjs restore --from 备份文件 [--db 目标库]

默认数据库：NOVA_DB 或 ./nova.db
默认备份目录：NOVA_BACKUP_DIR 或 ./backups
默认保留份数：NOVA_BACKUP_KEEP 或 14

恢复前请先停止正在使用该库的服务进程，否则文件可能被占用。
生产示例见 docs/OPS.md 与 scripts/backup.sh。`);
  process.exit(0);
}

function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function prune(folder, n) {
  mkdirSync(folder, {recursive: true});
  const files = readdirSync(folder)
    .filter(f => /^nova-\d{8}-\d{6}\.db$/.test(f))
    .map(f => ({f, t: statSync(join(folder, f)).mtimeMs}))
    .sort((a, b) => b.t - a.t);
  for (const x of files.slice(n)) {
    unlinkSync(join(folder, x.f));
    console.log('已删除过期备份', x.f);
  }
}

if (cmd === 'backup') {
  if (!existsSync(db)) {
    console.error('找不到数据库：' + db);
    process.exit(1);
  }
  mkdirSync(dir, {recursive: true});
  const dest = join(dir, 'nova-' + stamp() + '.db');
  const r = backupTo(db, dest);
  console.log('备份完成', r.path, r.size + ' 字节');
  prune(dir, keep);
  process.exit(0);
}

if (cmd === 'restore') {
  const from = arg('from', '');
  if (!from) {
    console.error('请用 --from 指定备份文件');
    process.exit(1);
  }
  const r = restoreFrom(from, db);
  console.log('已恢复到', r.path, r.size + ' 字节');
  process.exit(0);
}

console.error('未知命令，用 --help 查看用法');
process.exit(1);
