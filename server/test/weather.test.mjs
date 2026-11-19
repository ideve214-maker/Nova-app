// 天气 API：不访问外网。覆盖密钥开关、城市查询、IP 定位（查到 / 查不到 / 无 xdb）。
import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../index.mjs';
import {
  weatherConfig, parseLoc, normalizeNow, normalizeDaily, normalizeCities,
  attribution, DEFAULT_PLACE, parseLoc as parseLocation,
} from '../weather.mjs';
import {parseIp2regionLine, isPublicIp, normalizeIp, createIpLookup} from '../ip2region.mjs';

const HOST = 'abc.qweatherapi.com';
const ENV = {NOVA_QWEATHER_HOST: HOST, NOVA_QWEATHER_KEY: 'test-key'};

const BEIJING = {id: '101010100', name: '北京', adm1: '北京市', adm2: '北京', country: '中国', lat: '39.90', lon: '116.41'};
const SHENZHEN = {id: '101280601', name: '深圳', adm1: '广东省', adm2: '深圳', country: '中国', lat: '22.55', lon: '114.06'};

const NOW = {
  validTime: '2026-11-19T15:00+08:00',
  condition: {code: 100, text: '晴'},
  temperature: 18, feelsLike: 16, humidity: 0.4,
  wind: {scale: 2, direction: {compass: '北'}},
};
const DAILY = {days: [
  {forecastStartTime: '2026-11-19T00:00+08:00', temperatureMax: 20, temperatureMin: 8, daytime: {condition: {code: 100, text: '晴'}}},
  {forecastStartTime: '2026-11-20T00:00+08:00', temperatureMax: 19, temperatureMin: 9, daytime: {condition: {code: 101, text: '多云'}}},
  {forecastStartTime: '2026-11-21T00:00+08:00', temperatureMax: 17, temperatureMin: 7, daytime: {condition: {code: 305, text: '小雨'}}},
]};

function isWeatherUrl(u, kind) {
  const s = String(u);
  if (kind === 'geo') return s.includes('/geo/v2/city/lookup');
  if (kind === 'current') return s.includes('/weather/v1/current/');
  if (kind === 'daily') return s.includes('/weather/v1/daily/');
  return false;
}
function locParam(u) {
  const m = String(u).match(/[?&]location=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}
function coordsFromCurrent(u) {
  const m = String(u).match(/\/weather\/v1\/current\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/);
  return m ? {lat: Number(m[1]), lon: Number(m[2])} : null;
}

function mockWeatherFetch({fail = false, calls} = {}) {
  const log = calls || [];
  return async (url) => {
    log.push(String(url));
    if (fail) throw new Error('network down');
    if (isWeatherUrl(url, 'geo')) {
      const q = locParam(url);
      let list = [];
      if (/深圳|114\.06/.test(q)) list = [SHENZHEN];
      else if (/上海/.test(q)) list = [{id: '101020100', name: '上海', adm1: '上海市', adm2: '上海', country: '中国', lat: '31.23', lon: '121.47'}];
      else if (/北京|116\.41|101010100/.test(q) || /39\.9/.test(q)) list = [BEIJING];
      else if (/no-such-city/.test(q)) list = [];
      else list = [BEIJING];
      return {ok: true, status: 200, json: async () => ({code: '200', location: list})};
    }
    if (isWeatherUrl(url, 'current')) {
      const c = coordsFromCurrent(url);
      const text = (c && Math.abs(c.lat - 22.55) < 0.2) ? '多云' : '晴';
      const temp = (c && Math.abs(c.lat - 22.55) < 0.2) ? 26 : 18;
      return {ok: true, status: 200, json: async () => ({...NOW, temperature: temp, condition: {code: 100, text}})};
    }
    if (isWeatherUrl(url, 'daily')) {
      return {ok: true, status: 200, json: async () => DAILY};
    }
    return {ok: false, status: 404, json: async () => ({})};
  };
}

let seq = 0;
async function boot(opts = {}) {
  const srv = createApp({
    weatherFetch: opts.weatherFetch || mockWeatherFetch(),
    weatherEnv: opts.weatherEnv !== undefined ? opts.weatherEnv : ENV,
    weatherIpLookup: opts.weatherIpLookup,
    trustProxy: opts.trustProxy === true,
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const call = async (m, p, body, tok, headers = {}) => {
    const r = await fetch(base + p, {
      method: m,
      headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {}), ...headers},
      body: body ? JSON.stringify(body) : undefined,
    });
    return {s: r.status, j: await r.json()};
  };
  const acc = async () => {
    const u = 'wx' + (++seq);
    const r = await call('POST', '/api/auth/register', {agree: true, username: u, email: u + '@x.test', password: 'Passw0rd123'});
    assert.equal(r.s, 200, JSON.stringify(r.j));
    return r.j.token;
  };
  return {srv, call, acc, close: () => new Promise(r => { srv.close(r); srv.closeAllConnections?.(); })};
}

test('parseLoc 识别坐标和城市 id', () => {
  assert.deepEqual(parseLoc('39.9,116.41'), {lat: 39.9, lon: 116.41});
  assert.deepEqual(parseLoc('101010100'), {id: '101010100'});
  assert.equal(parseLoc(''), null);
});

test('normalizeNow / daily / cities', () => {
  const n = normalizeNow(NOW);
  assert.equal(n.temp, 18);
  assert.equal(n.text, '晴');
  assert.equal(n.humidity, 40);
  const d = normalizeDaily(DAILY);
  assert.equal(d.length, 3);
  assert.equal(d[0].tempMax, 20);
  const c = normalizeCities({location: [BEIJING]});
  assert.equal(c[0].name, '北京');
  assert.match(attribution().text, /和风天气/);
});

test('weatherConfig：没配密钥就是未配置', () => {
  assert.equal(weatherConfig({}).configured, false);
  assert.equal(weatherConfig(ENV).configured, true);
  assert.equal(weatherConfig({NOVA_QWEATHER_HOST: 'https://abc.qweatherapi.com/', NOVA_QWEATHER_KEY: 'k'}).configured, true);
});

test('isPublicIp / parseIp2regionLine', () => {
  assert.equal(isPublicIp('127.0.0.1'), false);
  assert.equal(isPublicIp('10.0.0.1'), false);
  assert.equal(isPublicIp('192.168.1.1'), false);
  assert.equal(isPublicIp('::ffff:127.0.0.1'), false);
  assert.equal(isPublicIp('1.2.3.4'), true);
  assert.equal(normalizeIp('::ffff:1.2.3.4'), '1.2.3.4');
  const r = parseIp2regionLine('中国|0|广东省|深圳市|电信');
  assert.equal(r.name, '深圳市');
  assert.equal(r.province, '广东省');
  assert.equal(parseIp2regionLine('中国|0|0|0|内网IP'), null);
});

test('未登录不能查天气', async () => {
  const b = await boot();
  try {
    const r = await b.call('GET', '/api/weather');
    assert.equal(r.s, 401);
  } finally { await b.close(); }
});

test('没配密钥返回 configured:false', async () => {
  const b = await boot({weatherEnv: {}});
  try {
    const tok = await b.acc();
    const r = await b.call('GET', '/api/weather', null, tok);
    assert.equal(r.s, 200);
    assert.equal(r.j.configured, false);
    assert.equal(r.j.now, undefined);
  } finally { await b.close(); }
});

test('按 loc 返回当前天气和预报，带署名，不回传密钥', async () => {
  const b = await boot();
  try {
    const tok = await b.acc();
    const r = await b.call('GET', '/api/weather?loc=39.9,116.41&name=' + encodeURIComponent('北京'), null, tok);
    assert.equal(r.s, 200, JSON.stringify(r.j));
    assert.equal(r.j.configured, true);
    assert.equal(r.j.place.name, '北京');
    assert.equal(r.j.now.temp, 18);
    assert.equal(r.j.now.text, '晴');
    assert.equal(r.j.daily.length, 3);
    assert.match(r.j.attribution.text, /和风天气/);
    const dump = JSON.stringify(r.j);
    assert.ok(!dump.includes('test-key'));
  } finally { await b.close(); }
});

test('q= 搜索城市', async () => {
  const b = await boot();
  try {
    const tok = await b.acc();
    const r = await b.call('GET', '/api/weather?q=' + encodeURIComponent('上海'), null, tok);
    assert.equal(r.s, 200);
    assert.equal(r.j.cities[0].name, '上海');
  } finally { await b.close(); }
});

test('IP 能查到城市时用该城市（source=ip）', async () => {
  const calls = [];
  const seen = [];
  const b = await boot({
    weatherFetch: mockWeatherFetch({calls}),
    weatherIpLookup: {lookup: async (ip) => { seen.push(ip); return {name: '深圳', city: '深圳', province: '广东省', country: '中国'}; }},
    trustProxy: true,
  });
  try {
    const tok = await b.acc();
    const r = await b.call('GET', '/api/weather', null, tok, {'X-Forwarded-For': '1.2.3.4'});
    assert.equal(r.s, 200, JSON.stringify(r.j));
    assert.equal(r.j.source, 'ip');
    assert.equal(r.j.place.name, '深圳');
    assert.equal(r.j.now.temp, 26);
    assert.ok(seen.some(x => String(x).includes('1.2.3.4')), '应拿 X-Forwarded-For 里的客户端 IP');
    assert.ok(!JSON.stringify(r.j).includes('1.2.3.4'), '响应里不能出现原始 IP');
    assert.ok(calls.some(u => /深圳/.test(decodeURIComponent(u))), '应把城市名交给和风 Geo');
  } finally { await b.close(); }
});

test('IP 查不到时回退北京（source=default）', async () => {
  const b = await boot({
    weatherIpLookup: {lookup: async () => null},
    trustProxy: true,
  });
  try {
    const tok = await b.acc();
    const r = await b.call('GET', '/api/weather', null, tok, {'X-Forwarded-For': '8.8.8.8'});
    assert.equal(r.s, 200, JSON.stringify(r.j));
    assert.equal(r.j.source, 'default');
    assert.equal(r.j.place.name, DEFAULT_PLACE.name);
    assert.equal(r.j.now.temp, 18);
    assert.ok(!JSON.stringify(r.j).includes('8.8.8.8'));
  } finally { await b.close(); }
});

test('没有 xdb（默认 lookup）时回退北京', async () => {
  const b = await boot({
    weatherEnv: {...ENV, NOVA_IP2REGION_XDB: '/no/such/ip2region.xdb'},
    trustProxy: true,
  });
  try {
    const tok = await b.acc();
    const r = await b.call('GET', '/api/weather', null, tok, {'X-Forwarded-For': '1.2.3.4'});
    assert.equal(r.s, 200, JSON.stringify(r.j));
    assert.equal(r.j.source, 'default');
    assert.equal(r.j.place.name, '北京');
  } finally { await b.close(); }
});

test('不信任代理时不会把伪造的 X-Forwarded-For 当客户端 IP', async () => {
  const seen = [];
  const b = await boot({
    weatherIpLookup: {lookup: async (ip) => { seen.push(ip); return {name: '深圳'}; }},
    trustProxy: false,
  });
  try {
    const tok = await b.acc();
    const r = await b.call('GET', '/api/weather', null, tok, {'X-Forwarded-For': '1.2.3.4'});
    assert.equal(r.s, 200);
    // 直连是 127.0.0.1，lookup 对内网应直接跳过；即使被调用也不该用 1.2.3.4
    assert.ok(!seen.some(x => String(x).includes('1.2.3.4')), '未开 trustProxy 时不应采信 X-Forwarded-For: ' + seen.join(','));
    assert.equal(r.j.source, 'default');
    assert.equal(r.j.place.name, '北京');
  } finally { await b.close(); }
});

test('外网失败时给出明确错误，不泄露密钥', async () => {
  const b = await boot({weatherFetch: mockWeatherFetch({fail: true})});
  try {
    const tok = await b.acc();
    const r = await b.call('GET', '/api/weather?loc=39.9,116.41', null, tok);
    assert.equal(r.s, 503);
    assert.match(String(r.j.error && r.j.error.message), /暂时无法/);
    assert.ok(!JSON.stringify(r.j).includes('test-key'));
  } finally { await b.close(); }
});

test('createIpLookup 在没有 xdb 时对公网 IP 也返回 null', async () => {
  const lu = createIpLookup({env: {NOVA_IP2REGION_XDB: ''}});
  assert.equal(await lu.lookup('1.2.3.4'), null);
  assert.equal(await lu.lookup('127.0.0.1'), null);
});
