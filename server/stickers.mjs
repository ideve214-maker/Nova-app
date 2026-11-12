// 专属表情/贴纸包（M2.5.5）。全部为原创选用的 Unicode 表情，列入白名单；不使用第三方版权贴纸。
// 免费用户可以正常查看别人发出的贴纸并继续用基础包交流；选用香槟金包需要 premium_emoji_pack。
import {VipError} from './vip.mjs';

export const STICKER_PACKS = Object.freeze([
  Object.freeze({
    id: 'basic', title: '常用表情', premium: false,
    items: Object.freeze([
      {id: 'smile', glyph: '😊', name: '微笑'}, {id: 'heart', glyph: '❤️', name: '爱心'},
      {id: 'thumb', glyph: '👍', name: '赞'}, {id: 'laugh', glyph: '😂', name: '大笑'},
      {id: 'wow', glyph: '😮', name: '惊讶'}, {id: 'sad', glyph: '😢', name: '难过'},
      {id: 'fire', glyph: '🔥', name: '火'}, {id: 'wave', glyph: '🙌', name: '加油'},
    ]),
  }),
  Object.freeze({
    id: 'nova_gold', title: '香槟金系列', premium: true, entitlement: 'premium_emoji_pack',
    review: '原创 Unicode 表情白名单，已纳入内容审核范围；不使用第三方版权贴纸。',
    items: Object.freeze([
      {id: 'gold_star', glyph: '🌟', name: '金星'}, {id: 'gold_cheers', glyph: '🥂', name: '香槟'},
      {id: 'gold_sparkle', glyph: '✨', name: '闪光'}, {id: 'gold_crown', glyph: '👑', name: '皇冠'},
      {id: 'gold_rose', glyph: '🌹', name: '玫瑰'}, {id: 'gold_moon', glyph: '🌙', name: '月夜'},
      {id: 'gold_book', glyph: '📖', name: '书页'}, {id: 'gold_coffee', glyph: '☕', name: '咖啡'},
    ]),
  }),
]);

const byId = new Map();
for (const p of STICKER_PACKS) for (const it of p.items) byId.set(p.id + ':' + it.id, {pack: p, item: it});

export function findSticker(packId, id) { return byId.get(String(packId) + ':' + String(id)) || null; }

export function createStickers({vip}) {
  function catalog(user) {
    return {
      packs: STICKER_PACKS.map(p => {
        const usable = !p.premium || !!(user && vip.has(user, p.entitlement));
        return {
          id: p.id, title: p.title, premium: !!p.premium, usable,
          entitlement: p.entitlement || null,
          review: p.review || null,
          items: p.items.map(i => ({id: i.id, glyph: i.glyph, name: i.name})),
        };
      }),
      policy: '已发出的贴纸所有人都能看到；过期后不能再从专属面板选用。基础表情对所有人开放。',
    };
  }
  function use(user, {pack, id}) {
    const found = findSticker(pack, id);
    if (!found) throw new VipError(404, 'STICKER_NOT_FOUND', '贴纸不存在或未通过内容审核');
    if (found.pack.premium) vip.requireEntitlement(user, found.pack.entitlement);
    return {sticker: {pack: found.pack.id, id: found.item.id, glyph: found.item.glyph, name: found.item.name, premium: !!found.pack.premium}};
  }
  return {catalog, use};
}
