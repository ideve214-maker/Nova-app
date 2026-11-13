// NSFWJS（MobileNetV2）作为上传的第一道检查。默认关闭。
// off：不加载模型。on：超阈值拒绝。review：记为待人工复核，上传仍成功。
// 模型加载失败时降级为待复核，不把上传打成 500。
import {createHash} from 'node:crypto';

function threshold() { return Number(process.env.NOVA_NSFW_THRESHOLD || 0.75); }

export function nsfwMode() {
  const mode = String(process.env.NOVA_NSFW || 'off').trim().toLowerCase();
  if (mode === 'on' || mode === '1' || mode === 'true') return 'on';
  if (mode === 'review' || mode === 'queue') return 'review';
  return 'off';
}

let modelPromise = null;
let memoryNote = null;

export function nsfwMemoryNote() { return memoryNote; }

async function getModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const before = process.memoryUsage();
      const tf = await import('@tensorflow/tfjs');
      await tf.setBackend('cpu');
      await tf.ready();
      const nsfw = await import('nsfwjs');
      const model = await nsfw.load('MobileNetV2');
      const after = process.memoryUsage();
      memoryNote = {
        model: 'MobileNetV2',
        modelBytes: 3.4 * 1024 * 1024,
        rssBefore: before.rss,
        rssAfter: after.rss,
        heapAfter: after.heapUsed,
        deltaRss: after.rss - before.rss,
      };
      return {model, tf};
    })().catch(err => {
      modelPromise = null;
      throw err;
    });
  }
  return modelPromise;
}

function topClass(preds) {
  const list = Array.isArray(preds) ? preds : [];
  let best = list[0] || {className: '', probability: 0};
  for (const p of list) if (p.probability > best.probability) best = p;
  const hot = list.filter(p => p.className === 'Porn' || p.className === 'Hentai');
  const hotP = hot.reduce((m, p) => Math.max(m, p.probability || 0), 0);
  return {best, hotP, summary: list.map(p => p.className + ':' + Number(p.probability).toFixed(3)).join(',')};
}

export function createNsfwScan() {
  return async function scan(file) {
    const mode = nsfwMode();
    if (mode === 'off') return {status: 'skipped', reason: 'NSFW 扫描已关闭'};
    if (!file || file.kind !== 'image' || !file.buffer) return {status: 'skipped', reason: '非图片，跳过图像扫描'};
    try {
      const {model, tf} = await getModel();
      const sharp = (await import('sharp')).default;
      const raw = await sharp(file.buffer).resize(224, 224, {fit: 'fill'}).removeAlpha().raw().toBuffer({resolveWithObject: true});
      const tensor = tf.tensor3d(new Uint8Array(raw.data), [raw.info.height, raw.info.width, 3], 'int32');
      let preds;
      try { preds = await model.classify(tensor); }
      finally { tensor.dispose(); }
      const {hotP, summary} = topClass(preds);
      const flagged = hotP >= threshold();
      if (flagged && mode === 'on') return {status: 'blocked', reason: '图像扫描未通过 ' + summary, detail: summary};
      if (flagged) return {status: 'review', reason: '图像待人工复核 ' + summary, detail: summary};
      return {status: 'clean', reason: summary, detail: summary};
    } catch (err) {
      const why = '扫描不可用，已降级为待人工复核：' + (err && err.message ? err.message : 'error');
      return {status: 'review', reason: why, degraded: true};
    }
  };
}

export function shaOf(buf) {
  return createHash('sha256').update(buf).digest('hex');
}
