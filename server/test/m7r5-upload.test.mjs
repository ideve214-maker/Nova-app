// r5：sharp 去掉 EXIF；NSFW 关闭时上传仍成功；处理失败不保留原文件。
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {createApp} from '../index.mjs';
import {nsfwMode} from '../nsfw-scan.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('默认不开启 NSFW 扫描', () => {
  assert.equal(nsfwMode(), 'off');
});

test('sharp 压缩图片并去掉 GPS，扫描关闭时上传成功', async () => {
  const gps = {
    GPSLatitude: '31/1',
    GPSLatitudeRef: 'N',
    GPSLongitude: '121/1',
    GPSLongitudeRef: 'E',
  };
  const jpeg = await sharp({create: {width: 8, height: 8, channels: 3, background: '#336699'}})
    .jpeg()
    .withMetadata({exif: {IFD0: {ImageDescription: 'secret'}, GPS: gps}})
    .toBuffer();
  const before = await sharp(jpeg).metadata();
  assert.ok(before.exif, 'fixture has exif');
  const dir = mkdtempSync(join(tmpdir(), 'nova-r5-'));
  const prev = process.env.NOVA_NSFW;
  process.env.NOVA_NSFW = 'off';
  const srv = createApp({mediaDir: dir});
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    const reg = await fetch(base + '/api/auth/register', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({agree:true, username:'r5img', email:'r5img@x.test', password:'Passw0rd123'})});
    const aj = await reg.json();
    const up = await fetch(base + '/api/media', {method:'POST', headers:{'Content-Type':'application/json', Authorization:'Bearer '+aj.token}, body: JSON.stringify({name:'loc.jpg', mime:'image/jpeg', data: jpeg.toString('base64')})});
    const uj = await up.json();
    assert.equal(up.status, 200, JSON.stringify(uj));
    assert.equal(uj.media.scanStatus, 'skipped');
    const row = srv.db.prepare('SELECT * FROM media WHERE id=?').get(uj.media.id);
    const stored = readFileSync(join(dir, row.path));
    const meta = await sharp(stored).metadata();
    assert.equal(meta.exif, undefined);
    assert.equal(meta.format, 'jpeg');
    assert.ok(existsSync(join(dir, row.preview_path)));
    assert.equal(existsSync(join(dir, uj.media.id + '.bin')), false);
  } finally {
    srv.close();
    if (prev == null) delete process.env.NOVA_NSFW; else process.env.NOVA_NSFW = prev;
  }
});
