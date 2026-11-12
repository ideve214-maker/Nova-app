// SQLite 一致性备份（VACUUM INTO）与恢复。
import {existsSync, mkdirSync, copyFileSync, statSync, unlinkSync, renameSync} from 'node:fs';
import {dirname, resolve, join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

export function backupTo(srcPath, destPath) {
  if (!srcPath || srcPath === ':memory:') {
    throw new Error('内存库请传入已打开的 DatabaseSync，或使用 backupOpen');
  }
  const dest = resolve(destPath);
  mkdirSync(dirname(dest), {recursive: true});
  if (existsSync(dest)) unlinkSync(dest);
  const db = new DatabaseSync(srcPath);
  try {
    // VACUUM INTO 生成一致快照，不打断 WAL 源库
    db.exec("VACUUM INTO '" + dest.replace(/'/g, "''") + "'");
  } finally {
    try { db.close(); } catch {}
  }
  if (!existsSync(dest) || statSync(dest).size < 16) throw new Error('备份文件未生成');
  return {path: dest, size: statSync(dest).size, at: Date.now()};
}

/** 对已打开的连接做 VACUUM INTO（含 :memory:）。路径由我们转义，不接受未消毒的拼接。 */
export function backupOpen(db, destPath) {
  const dest = resolve(destPath);
  mkdirSync(dirname(dest), {recursive: true});
  if (existsSync(dest)) unlinkSync(dest);
  if (typeof dest !== 'string' || dest.includes('\0') || dest.includes('\n')) throw new Error('非法备份路径');
  db.exec("VACUUM INTO '" + dest.replace(/'/g, "''") + "'");
  if (!existsSync(dest)) throw new Error('备份文件未生成');
  return {path: dest, size: statSync(dest).size, at: Date.now()};
}

export function restoreFrom(backupPath, destPath) {
  const src = resolve(backupPath), dest = resolve(destPath);
  if (!existsSync(src)) throw new Error('找不到备份文件');
  // 先校验备份能打开且有 schema_migrations
  const chk = new DatabaseSync(src, {readOnly: true});
  try {
    const n = chk.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='schema_migrations'").get();
    if (!n || !n.n) throw new Error('备份不像是本项目的数据库');
  } finally { try { chk.close(); } catch {} }
  mkdirSync(dirname(dest), {recursive: true});
  const tmp = dest + '.restore-tmp-' + Date.now();
  copyFileSync(src, tmp);
  // 若目标被占用，调用方应先关闭连接
  try {
    if (existsSync(dest)) {
      const bak = dest + '.pre-restore-' + Date.now();
      renameSync(dest, bak);
    }
    renameSync(tmp, dest);
  } catch (e) {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch {}
    throw e;
  }
  return {path: dest, size: statSync(dest).size, at: Date.now()};
}
