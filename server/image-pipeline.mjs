// 图片上传：压缩、缩略图，并去掉 EXIF/GPS。失败时不落盘原文件。
import sharp from 'sharp';

export async function processUploadImage(buffer) {
  if (!buffer || !buffer.length) throw new Error('empty image');
  const base = sharp(buffer, {failOn: 'error', animated: false}).rotate();
  const main = await base.clone()
    .resize({width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true})
    .jpeg({quality: 82, mozjpeg: true})
    .toBuffer({resolveWithObject: true});
  const preview = await sharp(main.data)
    .resize({width: 480, height: 480, fit: 'inside', withoutEnlargement: true})
    .jpeg({quality: 70})
    .toBuffer();
  const meta = await sharp(main.data).metadata();
  if (meta.exif || meta.gps || meta.icc) throw new Error('metadata still present');
  return {
    main: main.data,
    preview,
    width: main.info.width || null,
    height: main.info.height || null,
    mime: 'image/jpeg',
  };
}

/** 2.0.1：背景 / 封面变体——最长边 1080、WebP，体积通常是原图的 1/3。 */
export async function makeCoverVariant(buffer) {
  return sharp(buffer, {failOn: 'none', animated: false}).rotate()
    .resize({width: 1080, height: 1080, fit: 'inside', withoutEnlargement: true})
    .webp({quality: 78, effort: 4})
    .toBuffer();
}
