// 离线 IP→城市：官方 ip2region JavaScript 查询客户端（Apache-2.0 / MIT）。
// https://github.com/lionsoul2014/ip2region
// xdb 数据文件不进仓库、不进客户端、不进热更新包；路径由 NOVA_IP2REGION_XDB 指定。
// 本模块不记录、不缓存原始 IP。

import {existsSync} from 'node:fs';

export function normalizeIp(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (s.startsWith('[') && s.includes(']')) s = s.slice(1, s.indexOf(']'));
  if (s.startsWith('::ffff:')) s = s.slice(7);
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(s)) s = s.replace(/:\d+$/, '');
  return s;
}

export function isPublicIp(raw) {
  const s = normalizeIp(raw);
  if (!s) return false;
  if (s === '127.0.0.1' || s === '::1' || s === '0.0.0.0' || s === 'localhost') return false;
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2], c = +m[3], d = +m[4];
    if ([a, b, c, d].some(n => n > 255)) return false;
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false;
    if (a >= 224) return false;
    return true;
  }
  if (!s.includes(':')) return false;
  const t = s.toLowerCase();
  if (t.startsWith('fc') || t.startsWith('fd') || t.startsWith('fe80')) return false;
  return true;
}

export function isIPv6(raw) {
  const s = normalizeIp(raw);
  return s.includes(':');
}

function cleanPart(s) {
  s = String(s || '').trim();
  if (!s || s === '0' || s === '内网IP' || s === '*' || /^0+$/.test(s)) return '';
  return s;
}

/** ip2region 行：国家|区域|省份|城市|ISP → 用于和风 Geo 的城市名。 */
export function parseIp2regionLine(line) {
  const parts = String(line || '').split('|');
  if (parts.length < 4) return null;
  const country = cleanPart(parts[0]);
  const province = cleanPart(parts[2]);
  let city = cleanPart(parts[3]);
  if (city.endsWith('市') && city.length > 1) {
    /* 保留“市”，和风 Geo 能识别“深圳市”和“深圳” */
  }
  const name = city || province;
  if (!name) return null;
  return {country, province, city: city || '', name};
}

export function ip2regionConfig(env = process.env) {
  const pick = k => String((env && env[k]) || '').trim();
  return {
    xdb: pick('NOVA_IP2REGION_XDB'),
    xdbV6: pick('NOVA_IP2REGION_XDB_V6'),
  };
}

async function loadSearcher(path) {
  if (!path || !existsSync(path)) return null;
  const {loadHeaderFromFile, versionFromHeader, loadContentFromFile, newWithBuffer} = await import('./vendor/ip2region/index.js');
  const header = loadHeaderFromFile(path);
  const version = versionFromHeader(header);
  const buf = loadContentFromFile(path);
  return newWithBuffer(version, buf);
}

/**
 * 创建 IP→城市查询。searchFn 供测试注入（异步或同步，入参已是规范化 IP，返回 region 对象或一行文本或 null）。
 * 缺少 xdb 或查询失败时返回 null，由天气模块回退默认城市。不缓存 IP。
 */
export function createIpLookup({env = process.env, searchFn, v4Searcher, v6Searcher} = {}) {
  const cfg = ip2regionConfig(env);
  let v4p, v6p;
  async function getV4() {
    if (v4Searcher) return v4Searcher;
    if (v4p === undefined) v4p = searchFn ? null : loadSearcher(cfg.xdb).catch(() => null);
    return v4p;
  }
  async function getV6() {
    if (v6Searcher) return v6Searcher;
    if (v6p === undefined) v6p = searchFn ? null : loadSearcher(cfg.xdbV6).catch(() => null);
    return v6p;
  }

  async function lookup(raw) {
    const ip = normalizeIp(raw);
    if (!isPublicIp(ip)) return null;
    try {
      if (searchFn) {
        const r = await searchFn(ip);
        if (r == null || r === '') return null;
        if (typeof r === 'object') return r.name ? r : null;
        return parseIp2regionLine(r);
      }
      const searcher = isIPv6(ip) ? await getV6() : await getV4();
      if (!searcher || typeof searcher.search !== 'function') return null;
      const line = await searcher.search(ip);
      return parseIp2regionLine(line);
    } catch {
      return null;
    }
  }

  return {lookup, config: cfg};
}
