// 2.0.1 共创项目的公开分享页 /p/<id>：只读，给微信等不认纯文字分享的地方一个可以打开的链接。
// 不需要登录；只显示项目的公开信息（不含成员、任务、文件、群聊）。
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const ST = {recruiting: '招募中', active: '进行中', completed: '已完成', cancelled: '已取消'};

const notFound = (dl, what) => ({status: 404, html: page(what + '不存在', `<main class="c"><p class="brand">VEXO</p><h1>这个${what}不存在或已被移除</h1><p class="m">可能已被发布者删除或关闭。</p><div class="cta"><a class="b" href="${esc(dl)}">下载 VEXO</a></div></main>`, '')});
const dlOf = u => /^(https?:\/\/|\/)/.test(u || '') ? u : '/download/vexo/';
const cta = (dl, how) => `<div class="cta"><a class="b" href="${esc(dl)}">下载 VEXO</a><p class="m">${how}</p></div>`;

export function renderProjectPage(card, {downloadUrl} = {}) {
  const dl = dlOf(downloadUrl);
  if (!card) return notFound(dl, '项目');
  const desc = card.goal || card.description || '';
  const skills = card.skills.length ? `<section><h2>需要的技能</h2><div class="sk">${card.skills.map(s => `<span>${esc(s)}</span>`).join('')}</div></section>` : '';
  const intro = card.description ? `<section><h2>项目介绍</h2><p class="d">${esc(card.description)}</p></section>` : '';
  const show = card.showcase ? `<section><h2>🎉 成果展示</h2><p class="d">${esc(card.showcase)}</p></section>` : '';
  const body = `<main class="c"><p class="brand">VEXO 共创</p><span class="pill p-${esc(card.status)}">${esc(ST[card.status] || '')}</span>
<h1>${esc(card.title)}</h1><p class="g">${esc(card.goal)}</p><p class="m">成员 ${Number(card.memberCount) || 0}/${Number(card.capacity) || 0}</p>
${show}${skills}${intro}${cta(dl, `已经安装了？打开 VEXO →「共创」→「共创项目」，搜索「${esc(card.title)}」即可申请加入。`)}</main>`;
  return {status: 200, html: page(card.title + ' · VEXO 共创', body, desc)};
}

export function renderExchangePage(card, {downloadUrl} = {}) {
  const dl = dlOf(downloadUrl);
  if (!card) return notFound(dl, '技能交换');
  const body = `<main class="c"><p class="brand">VEXO 技能交换</p>${card.open ? '<span class="pill">交换中</span>' : '<span class="pill p-cancelled">已关闭</span>'}${card.categoryLabel ? ` <span class="pill p-cat">${esc(card.categoryLabel)}</span>` : ''}
<section><h2>我会</h2><p class="g">${esc(card.offers)}</p></section><section><h2>我想学</h2><p class="g">${esc(card.wants)}</p></section>
${card.note ? `<section><h2>补充说明</h2><p class="d">${esc(card.note)}</p></section>` : ''}
${cta(dl, '已经安装了？打开 VEXO →「共创」→「技能交换」，搜索上面的技能即可找到并私聊咨询。')}</main>`;
  return {status: 200, html: page('技能交换：' + card.offers.slice(0, 20) + ' ⇄ ' + card.wants.slice(0, 20), body, '我会：' + card.offers + '；想学：' + card.wants)};
}

const fmt = ms => { if (!ms) return ''; const d = new Date(Number(ms) + 8 * 3600e3), p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getUTCDay()]} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };
const AST = {upcoming: '报名中', ongoing: '进行中', ended: '已结束'};
export function renderActivityPage(card, {downloadUrl} = {}) {
  const dl = dlOf(downloadUrl);
  if (!card) return notFound(dl, '活动');
  const when = fmt(card.startsAt) + (card.endsAt ? ' – ' + fmt(card.endsAt) : '');
  const body = `<main class="c"><p class="brand">VEXO 官方活动</p><span class="pill${card.state === 'ended' ? ' p-cancelled' : ''}">${esc(AST[card.state] || '')}</span>
<h1>${esc(card.title)}</h1><p class="m">🕒 ${esc(when)}（北京时间）</p><p class="m">📍 ${esc(card.online ? '线上' : card.place)}</p>
<p class="m">已报名 ${Number(card.count) || 0}${card.cap ? ' / ' + Number(card.cap) : ''}</p>
${card.description ? `<section><h2>活动介绍</h2><p class="d">${esc(card.description)}</p></section>` : ''}
${cta(dl, '已经安装了？打开 VEXO，在首页找到这条活动即可报名。')}</main>`;
  return {status: 200, html: page(card.title + ' · VEXO 活动', body, when + ' · ' + (card.online ? '线上' : card.place))};
}

function page(title, body, desc) {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(String(desc).slice(0, 120))}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(String(desc).slice(0, 120))}"><meta property="og:type" content="website">
<meta name="robots" content="noindex">
<style>
body{margin:0;font:16px/1.6 -apple-system,"PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif;background:#F3F4F9;color:#13151C}
.c{max-width:560px;margin:0 auto;padding:28px 20px 48px}
.brand{font-weight:700;color:#4F6EF7;margin:0 0 14px;letter-spacing:.02em}
h1{font-size:24px;line-height:1.3;margin:10px 0 6px;word-break:break-word}
h2{font-size:15px;margin:22px 0 8px;color:#5C6478}
.g{font-size:17px;margin:0 0 6px;word-break:break-word}.d{white-space:pre-wrap;word-break:break-word;margin:0}
.m{color:#5C6478;font-size:14px;margin:6px 0}
.pill{display:inline-block;font-size:13px;padding:2px 10px;border-radius:99px;background:#E4E9FF;color:#3550D6}
.p-cat{background:#FFF1DB;color:#9A5B00}.p-completed{background:#DFF5E7;color:#1D7A44}.p-cancelled{background:#ECEDF2;color:#5C6478}
.sk{display:flex;flex-wrap:wrap;gap:8px}.sk span{font-size:15px;padding:5px 12px;border-radius:99px;background:#fff;border:1px solid #E0E3EC}
.cta{margin-top:30px;text-align:center}
.b{display:inline-flex;align-items:center;justify-content:center;min-width:200px;height:46px;border-radius:23px;background:#4F6EF7;color:#fff;text-decoration:none;font-weight:600;font-size:16px}
</style></head><body>${body}</body></html>`;
}
