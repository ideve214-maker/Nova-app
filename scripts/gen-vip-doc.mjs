// 由 server/vip-config.mjs 生成 docs/spec/09_VIP权益与额度.md，保证文档和配置不会各说各话。
// 用法：node scripts/gen-vip-doc.mjs        （写文件）
//       node scripts/gen-vip-doc.mjs --check （只检查是否最新，不写）
import {writeFileSync, readFileSync, existsSync} from 'node:fs';
import {VIP_CONFIG as C} from '../server/vip-config.mjs';

const fmt = (e, plan) => {
  const v = e[plan];
  if (v === null) return '待定';
  if (e.kind === 'flag') return v ? '✅ 有' : '—';
  if (typeof v === 'object') return Object.entries(v).map(([s, n]) => `${e.scopeNames[s]} ${n}`).join('；') + ' ' + e.unit;
  return `${v} ${e.unit}`;
};

export function renderDoc() {
  const vip = C.plans.vip;
  const rows = Object.entries(C.entitlements).map(([k, e]) =>
    `| \`${k}\` | ${e.title} | ${fmt(e, 'basic')} | ${fmt(e, 'vip')} | ${e.status === 'live' ? '已实现' : '待实现'} · ${e.phase} | ${e.onExpire} |`);
  return `# NOVA VIP 权益与额度（自动生成，请勿手改）

> 来源：\`server/vip-config.mjs\`。改配置后运行 \`node scripts/gen-vip-doc.mjs\` 重新生成；\`npm run test:server\` 会检查本文件是否最新。
> 价格与权益均为占位，支付功能未接入。调研依据见 \`docs/research/\`。

## 套餐
| 套餐 | 说明 | 价格 |
|---|---|---|
| ${C.plans.basic.name} | ${C.plans.basic.tagline} | 免费 |
| ${vip.name} | ${vip.tagline} | ${vip.prices.map(p => p.label).join('；')}（${vip.priceNote}${vip.purchase.label}：${vip.purchase.reason}） |

## 权益表
| entitlement key | 名称 | Basic | VIP | 状态 | 到期后的行为 |
|---|---|---|---|---|---|
${rows.join('\n')}

## 到期规则
- ${C.expiry.rule}
- ${C.expiry.dataPolicy}
- 距到期不足 ${C.expiry.soonDays} 天时状态为 \`expiring\`（仅用于提醒，权益仍有效）。
- 开发环境「测试 VIP」一次授予 ${C.expiry.testGrantDays} 天（仅 \`NOVA_ENV=development\`）。

## 永远免费（不进入权益表）
${C.alwaysFree.map(x => '- ' + x).join('\n')}

## 不出售
${C.neverSold.map(x => '- ' + x).join('\n')}
`;
}

export const DOC_PATH = new URL('../docs/spec/09_VIP权益与额度.md', import.meta.url);

if (import.meta.url === `file://${process.argv[1]}`) {
  const text = renderDoc();
  if (process.argv.includes('--check')) {
    const ok = existsSync(DOC_PATH) && readFileSync(DOC_PATH, 'utf8') === text;
    console.log(ok ? '权益表文档是最新的' : '权益表文档已过期，请运行 node scripts/gen-vip-doc.mjs');
    process.exit(ok ? 0 : 1);
  }
  writeFileSync(DOC_PATH, text);
  console.log('已生成 docs/spec/09_VIP权益与额度.md');
}
