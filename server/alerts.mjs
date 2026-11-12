// 告警钩子：崩溃、磁盘不足、数据库错误、SSE/推送失败。通过 NOVA_ALERT_WEBHOOK 发 JSON。
import {statfsSync, existsSync} from 'node:fs';
import {slog, redact} from './security.mjs';

export function createAlerts({webhook = process.env.NOVA_ALERT_WEBHOOK, fetchImpl = fetch, now = Date.now, minFreeBytes = 100 * 1024 * 1024, dataDir = '.'} = {}) {
  const last = new Map();
  function cooldown(kind, ms = 5 * 60e3) {
    const t = last.get(kind) || 0;
    if (now() - t < ms) return false;
    last.set(kind, now());
    return true;
  }
  async function send(kind, payload) {
    const body = {ts: new Date(now()).toISOString(), kind, source: 'nova', ...redact(payload || {})};
    slog('alert', kind, body);
    if (!webhook) return {sent: false, logged: true, kind};
    if (!cooldown(kind)) return {sent: false, throttled: true, kind};
    try {
      const r = await fetchImpl(webhook, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
      });
      return {sent: r.ok, status: r.status, kind};
    } catch (e) {
      slog('error', 'alert_webhook_failed', {error: e.message, kind});
      return {sent: false, error: e.message, kind};
    }
  }
  function disk() {
    try {
      const s = statfsSync(dataDir);
      const free = (s.bfree ?? s.bavail ?? 0) * (s.bsize || 4096);
      const total = (s.blocks || 0) * (s.bsize || 4096);
      const low = free < minFreeBytes;
      if (low) send('low_disk', {free, total, path: dataDir});
      return {free, total, low};
    } catch (e) {
      return {free: null, total: null, low: false, error: e.message};
    }
  }
  function dbError(err, extra) { return send('db_error', {error: String(err && err.message || err), ...extra}); }
  function crash(err, extra) { return send('crash', {error: String(err && err.message || err), stack: err && err.stack ? String(err.stack).slice(0, 1500) : undefined, ...extra}); }
  function sseFailure(err, extra) { return send('sse_failure', {error: String(err && err.message || err), ...extra}); }
  function startWatch() {
    const iv = setInterval(() => { try { disk(); } catch {} }, 60e3);
    if (iv.unref) iv.unref();
    return () => clearInterval(iv);
  }
  return {send, disk, dbError, crash, sseFailure, startWatch};
}
