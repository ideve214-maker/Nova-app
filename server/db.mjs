// 数据库：node:sqlite + 顺序迁移文件。迁移只增不改。
import {DatabaseSync} from 'node:sqlite';
import {readdirSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join, dirname} from 'node:path';
const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
export function openDb(path = ':memory:', {migrationsDir} = {}) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, at INTEGER)');
  const done = new Set(db.prepare('SELECT name FROM schema_migrations').all().map(r => r.name));
  const migDir = migrationsDir || dir;
  for (const f of readdirSync(migDir).filter(f => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    db.exec('BEGIN');
    try { db.exec(readFileSync(join(migDir, f), 'utf8')); db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(f, Date.now()); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw new Error('迁移失败 ' + f + ': ' + e.message); }
  }
  return db;
}
