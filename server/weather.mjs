// 天气卡片：只在服务器上调用和风天气官方 API。密钥不进客户端、不进仓库。
// 文档：https://dev.qweather.com （Geo v2 + Weather v1 current/daily）
// 图标来自 qwd/Icons（代码 MIT，图标 CC BY 4.0）。
// 默认城市：用 ip2region 根据请求 IP 离线查出城市，再走和风 Geo；没有 xdb 或查不到则用北京。
// 不记录、不存储原始 IP。

import {createIpLookup, isPublicIp, normalizeIp} from './ip2region.mjs';

export const QWEATHER_SITE = 'https://www.qweather.com';
export const ICONS_REPO = 'https://github.com/qwd/Icons';
export const IP2REGION_REPO = 'https://github.com/lionsoul2014/ip2region';
const UA = 'VEXO-weather (+https://github.com/ideve214-maker/VEXOold)';
const WEATHER_TTL = 10 * 60 * 1000;
const GEO_TTL = 60 * 60 * 1000;
const DEFAULT_LANG = 'zh';

export const DEFAULT_PLACE = {
  id: '101010100',
  name: '北京',
  adm1: '北京市',
  adm2: '北京',
  country: '中国',
  lat: 39.9,
  lon: 116.41,
};

export class WeatherError extends Error {
  constructor(s, code, message) { super(message); this.s = s; this.code = code; }
}

export function attribution() {
  return {
    text: '天气服务由和风天气提供',
    url: QWEATHER_SITE,
    icons: '图标来自和风天气开源图标库（qwd/Icons），按 CC BY 4.0 使用。',
    iconsUrl: ICONS_REPO,
  };
}

export function weatherConfig(env = process.env) {
  const pick = k => String((env && env[k]) || '').trim();
  let host = pick('NOVA_QWEATHER_HOST').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const key = pick('NOVA_QWEATHER_KEY');
  const jwt = pick('NOVA_QWEATHER_JWT');
  return {host, key, jwt, configured: !!(host && (key || jwt))};
}

export function parseLoc(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^\d{6,12}$/.test(s)) return {id: s};
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return {lat: roundCoord(a), lon: roundCoord(b)};
  if (Math.abs(b) <= 90 && Math.abs(a) <= 180) return {lat: roundCoord(b), lon: roundCoord(a)};
  return null;
}

export function roundCoord(n) { return Math.round(Number(n) * 100) / 100; }

function num(v, d) {
  if (v == null) return d;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v.value != null) return Number(v.value);
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export function normalizeNow(raw = {}) {
  const cond = raw.condition || {};
  const icon = String(cond.code || raw.icon || '').replace(/\D/g, '') || '';
  const humidity = raw.humidity != null ? (raw.humidity <= 1 ? Math.round(raw.humidity * 100) : Math.round(raw.humidity)) : null;
  const wind = raw.wind || {};
  return {
    temp: Math.round(num(raw.temperature != null ? raw.temperature : raw.temp, NaN)),
    feelsLike: Math.round(num(raw.feelsLike, NaN)),
    text: String(cond.text || raw.text || ''),
    icon,
    humidity,
    windDir: (wind.direction && (wind.direction.compass || wind.direction.degree)) || raw.windDir || '',
    windScale: wind.scale != null ? wind.scale : raw.windScale,
    obsTime: raw.validTime || raw.obsTime || '',
  };
}

export function normalizeDaily(raw = {}) {
  const days = Array.isArray(raw.days) ? raw.days : (Array.isArray(raw.daily) ? raw.daily : []);
  return days.slice(0, 3).map(d => {
    const day = d.daytime || d;
    const cond = (day && day.condition) || d.condition || {};
    const start = d.forecastStartTime || d.fxDate || '';
    return {
      date: String(start).slice(0, 10),
      text: String(cond.text || d.textDay || d.text || ''),
      icon: String(cond.code || d.iconDay || d.icon || '').replace(/\D/g, ''),
      tempMax: Math.round(num(d.temperatureMax != null ? d.temperatureMax : d.tempMax, NaN)),
      tempMin: Math.round(num(d.temperatureMin != null ? d.temperatureMin : d.tempMin, NaN)),
    };
  });
}

export function normalizeCities(raw = {}) {
  const list = Array.isArray(raw.location) ? raw.location : (Array.isArray(raw.locations) ? raw.locations : []);
  return list.slice(0, 8).map(c => ({
    id: String(c.id || ''),
    name: String(c.name || ''),
    adm1: String(c.adm1 || ''),
    adm2: String(c.adm2 || ''),
    country: String(c.country || ''),
    lat: roundCoord(c.lat),
    lon: roundCoord(c.lon),
  })).filter(c => c.name && Number.isFinite(c.lat) && Number.isFinite(c.lon));
}

export {isPublicIp, normalizeIp};

export function createWeather({
  fetchFn = globalThis.fetch,
  env = process.env,
  now = Date.now,
  ttlMs = WEATHER_TTL,
  geoTtlMs = GEO_TTL,
  ipLookup,
} = {}) {
  const weatherCache = new Map();
  const geoCache = new Map();
  const lookup = ipLookup && typeof ipLookup.lookup === 'function'
    ? ipLookup
    : (typeof ipLookup === 'function' ? {lookup: ipLookup} : createIpLookup({env}));

  function cfg() { return weatherConfig(env); }

  function authHeaders() {
    const c = cfg();
    const h = {'User-Agent': UA, Accept: 'application/json'};
    if (c.jwt) h.Authorization = 'Bearer ' + c.jwt;
    else if (c.key) h['X-QW-Api-Key'] = c.key;
    return h;
  }

  async function httpGet(url) {
    const ctrl = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(8000) : undefined;
    const r = await fetchFn(url, {headers: authHeaders(), signal: ctrl, redirect: 'follow'});
    if (!r || !r.ok) {
      const err = new Error('http ' + (r && r.status));
      err.status = r && r.status;
      throw err;
    }
    return r.json();
  }

  function baseUrl() {
    const c = cfg();
    if (!c.configured) return '';
    return 'https://' + c.host;
  }

  async function geoLookup(q) {
    const query = String(q || '').trim();
    if (!query || query.length > 64) throw new WeatherError(400, 'BAD_REQUEST', '请输入要查找的城市。');
    const key = query.toLowerCase();
    const hit = geoCache.get(key);
    if (hit && now() - hit.at < geoTtlMs) return hit.cities;
    const url = baseUrl() + '/geo/v2/city/lookup?location=' + encodeURIComponent(query) + '&number=8&lang=' + DEFAULT_LANG;
    try {
      const raw = await httpGet(url);
      if (raw && raw.code && String(raw.code) !== '200' && !raw.location) {
        if (String(raw.code) === '404') return [];
        throw new Error('geo ' + raw.code);
      }
      const cities = normalizeCities(raw);
      geoCache.set(key, {at: now(), cities});
      return cities;
    } catch (e) {
      if (hit) return hit.cities;
      if (e instanceof WeatherError) throw e;
      throw new WeatherError(503, 'WEATHER_UNAVAILABLE', '暂时无法搜索城市，请检查网络后再试。');
    }
  }

  async function coordsFor(locRaw, placeHint) {
    const parsed = parseLoc(locRaw);
    if (!parsed) throw new WeatherError(400, 'BAD_REQUEST', '请提供城市或位置。');
    if (parsed.lat != null && parsed.lon != null) {
      let place = {id: '', name: '', lat: parsed.lat, lon: parsed.lon};
      if (placeHint && placeHint.name) place = {...place, ...placeHint, lat: parsed.lat, lon: parsed.lon};
      else {
        try {
          const cities = await geoLookup(parsed.lon + ',' + parsed.lat);
          if (cities[0]) place = cities[0];
        } catch { /* 有坐标也能查天气，地名缺失时由客户端显示坐标城市 */ }
      }
      return {lat: parsed.lat, lon: parsed.lon, place};
    }
    const cities = await geoLookup(parsed.id);
    if (!cities.length) throw new WeatherError(404, 'NOT_FOUND', '没有找到这个地点。');
    const c = cities[0];
    return {lat: c.lat, lon: c.lon, place: c};
  }

  async function getWeather(locRaw, placeHint) {
    const {lat, lon, place} = await coordsFor(locRaw, placeHint);
    const cacheKey = lat + ',' + lon;
    const hit = weatherCache.get(cacheKey);
    if (hit && now() - hit.at < ttlMs) {
      return {...hit.body, place: placeHint && placeHint.name ? {...hit.body.place, ...placeHint} : hit.body.place};
    }
    const root = baseUrl();
    const q = '?lang=' + DEFAULT_LANG + '&localTime=true';
    try {
      const [cur, daily] = await Promise.all([
        httpGet(root + '/weather/v1/current/' + lat + '/' + lon + q),
        httpGet(root + '/weather/v1/daily/' + lat + '/' + lon + q + '&days=3'),
      ]);
      const body = {
        configured: true,
        place: {
          id: (placeHint && placeHint.id) || place.id || '',
          name: (placeHint && placeHint.name) || place.name || '',
          adm1: (placeHint && placeHint.adm1) || place.adm1 || '',
          adm2: (placeHint && placeHint.adm2) || place.adm2 || '',
          country: (placeHint && placeHint.country) || place.country || '',
          lat, lon,
        },
        now: normalizeNow(cur),
        daily: normalizeDaily(daily),
        attribution: attribution(),
      };
      weatherCache.set(cacheKey, {at: now(), body});
      return body;
    } catch (e) {
      if (hit) return hit.body;
      if (e instanceof WeatherError) throw e;
      throw new WeatherError(503, 'WEATHER_UNAVAILABLE', '暂时无法获取天气，请检查网络后再试。');
    }
  }

  async function cityFromIp(clientIp) {
    if (!clientIp || !lookup || typeof lookup.lookup !== 'function') return null;
    if (!isPublicIp(clientIp)) return null;
    try {
      return await lookup.lookup(clientIp);
    } catch {
      return null;
    }
  }

  async function weatherFromIpOrDefault(clientIp) {
    const region = await cityFromIp(clientIp);
    if (region && region.name) {
      try {
        const cities = await geoLookup(region.name);
        const c = cities[0];
        if (c) {
          const body = await getWeather(c.lat + ',' + c.lon, c);
          return {...body, source: 'ip'};
        }
      } catch { /* 回退默认城市 */ }
    }
    const body = await getWeather(DEFAULT_PLACE.lat + ',' + DEFAULT_PLACE.lon, DEFAULT_PLACE);
    return {...body, source: 'default'};
  }

  async function handle(query = {}, ctx = {}) {
    if (!cfg().configured) return {configured: false};
    const loc = query.loc != null ? String(query.loc) : '';
    const q = query.q != null ? String(query.q) : (query.city != null ? String(query.city) : '');
    const placeHint = ctx.placeHint;
    if (loc.trim()) return {...await getWeather(loc, placeHint), source: 'loc'};
    if (q.trim()) {
      const cities = await geoLookup(q);
      return {configured: true, cities, attribution: attribution()};
    }
    return weatherFromIpOrDefault(ctx.clientIp);
  }

  return {handle, getWeather, geoLookup, cityFromIp, config: cfg, _cache: {weather: weatherCache, geo: geoCache}};
}
