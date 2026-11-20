// AI 官方内部账号的头像（Cc）：DiceBear 的 CC0 插画风格，在服务器本地生成（不连外网），再用 sharp 转成 JPEG。
// 许可：DiceBear 代码 MIT；Notionists（Zoish 作品改编）与 Lorelei（Lisa Wischofsky 作品改编）都是 CC0 1.0，
//       可商用、不需要署名。见 https://www.dicebear.com/licenses/ 与 https://creativecommons.org/publicdomain/zero/1.0/
// 不用 CC BY 4.0 的风格（Adventurer、Micah、Personas 等，需要署名），也不用 Avataaars（作者自定条款）。
// 依赖：@dicebear/core@9、@dicebear/collection@9（package.json 由 Dift 合并）；sharp 项目里已有。
// 头像右下角的「AI」角标由用户端（Bob）按 author.ai 叠加显示，不画进图片里，换风格或去掉角标都不用重新生成。

export const AVATAR_STYLES = Object.freeze([
  {key: 'notionists', label: 'Notionists', license: 'CC0 1.0', licenseUrl: 'https://www.dicebear.com/licenses/', author: 'Zoish（DiceBear 改编）'},
  {key: 'lorelei', label: 'Lorelei', license: 'CC0 1.0', licenseUrl: 'https://www.dicebear.com/licenses/', author: 'Lisa Wischofsky（DiceBear 改编）'},
]);
export const DEFAULT_AVATAR_STYLES = Object.freeze(['notionists', 'lorelei']);
export const AVATAR_BG = Object.freeze(['b6e3f4', 'c0aede', 'd1d4f9', 'ffd5dc', 'ffdfbf']);
const STYLE_KEYS = new Set(AVATAR_STYLES.map(s => s.key));
export const isAvatarStyle = k => STYLE_KEYS.has(String(k || ''));

let libs = null;
async function load() {
  if (libs) return libs;
  const [core, collection, sharp] = await Promise.all([import('@dicebear/core'), import('@dicebear/collection'), import('sharp')]);
  libs = {createAvatar: core.createAvatar, styles: {notionists: collection.notionists, lorelei: collection.lorelei}, sharp: sharp.default || sharp};
  return libs;
}

/** 生成 SVG 字符串（管理端预览用）。 */
export async function avatarSvg(style, seed, {size = 256} = {}) {
  const {createAvatar, styles} = await load();
  const s = styles[isAvatarStyle(style) ? style : DEFAULT_AVATAR_STYLES[0]];
  return createAvatar(s, {seed: String(seed), size, backgroundColor: [...AVATAR_BG], backgroundType: ['solid']}).toString();
}

/** 生成 JPEG（Buffer），用于上传成 AI 账号自己的图片媒体。 */
export async function avatarJpeg(style, seed, {size = 256, quality = 85} = {}) {
  const {sharp} = await load();
  const svg = await avatarSvg(style, seed, {size});
  return sharp(Buffer.from(svg)).resize(size, size).jpeg({quality}).toBuffer();
}

/** 管理端「头像风格」列表：带一张小预览（data URL）。 */
export async function avatarStylesWithPreview(seed = 'vexo-preview') {
  const out = [];
  for (const s of AVATAR_STYLES) {
    let preview = null;
    try { preview = 'data:image/svg+xml;base64,' + Buffer.from(await avatarSvg(s.key, seed, {size: 96})).toString('base64'); } catch { preview = null; }
    out.push({...s, preview});
  }
  return out;
}
