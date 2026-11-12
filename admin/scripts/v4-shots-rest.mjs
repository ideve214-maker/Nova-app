import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const out = "/workspace/nova-admin/screenshots/v4";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage", "--no-sandbox"] });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  locale: "zh-CN",
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
async function shot(name) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
  console.log("shot", name, await page.evaluate(() => location.hash));
}
async function safe(fn, label) {
  try { await fn(); } catch (e) { console.log("SKIP", label, e.message.split("\n")[0]); }
}

await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} });
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("text=NOVA 管理端");
await page.locator('input[placeholder="管理员账号"]').fill("admin");
await page.locator('input[placeholder="密码"]').fill("NovaAdm1n9");
await page.getByRole("button", { name: "登录" }).click();
await page.waitForSelector("text=管理后台");
await page.waitForTimeout(2000);

// content delete + restore
await page.goto("http://127.0.0.1:4173/#/content");
await page.waitForTimeout(1500);
await shot("11-content");
await safe(async () => {
  await page.getByRole("button", { name: "删除" }).first().click();
  await page.waitForSelector("text=删除内容", { timeout: 5000 });
  const area = page.locator("textarea");
  if (await area.count()) await area.fill("违规测试删除");
  await shot("12-content-delete-sheet");
  await page.getByRole("button", { name: "确认删除" }).click();
  await page.waitForTimeout(1000);
  await shot("12-content-deleted");
  await page.getByRole("button", { name: "已删除" }).click();
  await page.waitForTimeout(800);
  await shot("13-content-removed-tab");
  await page.getByRole("button", { name: "恢复" }).first().click();
  await page.waitForTimeout(800);
  await shot("14-content-restored");
}, "content-moderation");

// payments
await page.goto("http://127.0.0.1:4173/#/payments");
await page.waitForTimeout(1500);
await shot("15-payments-review");
await safe(async () => {
  const card = page.locator("button").filter({ hasText: /NV[A-Z0-9]+/ }).first();
  await card.click();
  await page.waitForTimeout(1800);
  await shot("16-payment-detail");
  const confirm = page.getByRole("button", { name: "确认开通 VIP" });
  if (await confirm.count()) {
    await confirm.click();
    await page.waitForTimeout(1500);
    await shot("17-payment-confirmed");
  } else {
    const rej = page.getByRole("button", { name: "拒绝" });
    if (await rej.count()) {
      await rej.click();
      await page.waitForTimeout(400);
      await shot("16b-payment-reject-form");
    }
    const refund = page.getByRole("button", { name: "退款并撤销 VIP" });
    if (await refund.count()) {
      await refund.click();
      await page.waitForTimeout(400);
      await shot("16c-payment-refund-form");
    }
  }
}, "payment-detail");
await safe(async () => {
  // close sheet if open
  const close = page.getByRole("button", { name: "关闭" });
  if (await close.count()) await close.click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "全部" }).click();
  await page.waitForTimeout(1000);
  await shot("18-payments-all");
}, "payments-all");

// If we confirmed the only review item, open all and a paid/refunded for refund label
await safe(async () => {
  const paid = page.locator("button").filter({ hasText: /已开通|已退款/ }).first();
  if (await paid.count()) {
    await paid.click();
    await page.waitForTimeout(1200);
    await shot("18b-payment-paid-or-refunded");
    const refund = page.getByRole("button", { name: "退款并撤销 VIP" });
    if (await refund.count()) {
      await refund.click();
      await page.waitForTimeout(400);
      await shot("18c-refund-sheet");
    }
  }
}, "refund-sheet");

await page.goto("http://127.0.0.1:4173/#/stats");
await page.waitForTimeout(1200);
await shot("19-stats");

await page.goto("http://127.0.0.1:4173/#/audit");
await page.waitForTimeout(1200);
await shot("20-audit");

await page.goto("http://127.0.0.1:4173/#/announce");
await page.waitForTimeout(1200);
await shot("21-announce");

await page.goto("http://127.0.0.1:4173/#/reports");
await page.waitForTimeout(1200);
await shot("22-reports");

await page.goto("http://127.0.0.1:4173/#/manage");
await page.waitForTimeout(800);
await shot("23-manage");

await page.goto("http://127.0.0.1:4173/#/me");
await page.waitForTimeout(800);
await shot("24-me");

await page.goto("http://127.0.0.1:4173/#/vip");
await page.waitForTimeout(800);
await shot("25-vip");

console.log("rest done");
await browser.close();
