import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const out = "/workspace/nova-admin/screenshots/v4";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--disable-dev-shm-usage", "--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  locale: "zh-CN",
});
const page = await context.newPage();
page.setDefaultTimeout(20000);
page.on("console", (msg) => console.log("BROWSER", msg.type(), msg.text()));
page.on("pageerror", (err) => console.log("PAGEERROR", err.message));

async function shot(name) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
  console.log("shot", name, await page.evaluate(() => location.hash));
}

await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle", timeout: 30000 });
await page.evaluate(() => {
  try { localStorage.clear(); sessionStorage.clear(); } catch {}
});
await page.reload({ waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(800);
await page.waitForSelector("text=NOVA 管理端", { timeout: 12000 });
await shot("01-login");

// wrong password
await page.locator('input[placeholder="管理员账号"]').fill("admin");
await page.locator('input[placeholder="密码"]').fill("wrongpass");
await page.getByRole("button", { name: "登录" }).click();
await page.waitForTimeout(800);
await shot("02-login-error");

// real login
await page.locator('input[placeholder="密码"]').fill("NovaAdm1n9");
await page.getByRole("button", { name: "登录" }).click();
await page.waitForSelector("text=管理后台", { timeout: 20000 });
await page.waitForTimeout(2500);
const onLogin = await page.locator("text=NOVA 管理端").count();
const onHome = await page.locator("text=管理后台").count();
console.log("after login onLogin", onLogin, "onHome", onHome, "hash", await page.evaluate(() => location.hash), "authed", await page.evaluate(() => localStorage.getItem("vexo-admin-v2")?.slice(0,80)));
await shot("03-home");

// users
await page.getByRole("button", { name: "用户管理" }).first().click();
await page.waitForTimeout(1200);
await shot("04-users");

// open linxia (VIP)
const lin = page.getByText("linxia", { exact: false }).first();
if (await lin.count()) {
  await lin.click();
  await page.waitForTimeout(800);
  await shot("05-user-vip");
  // grant already has VIP — open 续期
  const vipTab = page.getByRole("button", { name: "VIP 记录" });
  if (await vipTab.count()) {
    await vipTab.click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: /续期|手动开通/ }).click();
    await page.waitForTimeout(300);
    await page.locator('input[placeholder="例如 朋友体验"]').fill("截图演示续期");
    await shot("06-user-grant-sheet");
    await page.getByRole("button", { name: "确认" }).click();
    await page.waitForTimeout(1000);
    await shot("07-user-granted");
  }
  await page.getByRole("button", { name: "返回" }).click().catch(() => {});
  await page.waitForTimeout(400);
}

// open alice — reset password + ban
const alice = page.getByText("alice", { exact: false }).first();
if (await alice.count()) {
  await alice.click();
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "重置密码" }).click();
  await page.waitForTimeout(800);
  await shot("08-temp-password");
  // close sheet
  const close = page.getByRole("button", { name: "复制并关闭" });
  if (await close.count()) await close.click();
  else {
    const c2 = page.getByRole("button", { name: "关闭" });
    if (await c2.count()) await c2.click();
  }
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "封禁账号" }).click();
  await page.waitForTimeout(800);
  await shot("09-user-banned");
  await page.getByRole("button", { name: "解除封禁" }).click();
  await page.waitForTimeout(800);
  await shot("10-user-unbanned");
  await page.getByRole("button", { name: "返回" }).click().catch(() => {});
}

// content
await page.goto("http://127.0.0.1:4173/#/content", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await shot("11-content");
const del = page.getByRole("button", { name: "删除" }).first();
if (await del.count()) {
  await del.click();
  await page.waitForTimeout(300);
  const area = page.locator("textarea");
  if (await area.count()) await area.fill("违规测试删除");
  await page.getByRole("button", { name: "确认删除" }).click();
  await page.waitForTimeout(1000);
  await shot("12-content-deleted");
  // filter removed and restore
  const removed = page.getByRole("button", { name: "已删除" });
  if (await removed.count()) {
    await removed.click();
    await page.waitForTimeout(800);
    await shot("13-content-removed-tab");
    const rst = page.getByRole("button", { name: "恢复" }).first();
    if (await rst.count()) {
      await rst.click();
      await page.waitForTimeout(800);
      await shot("14-content-restored");
    }
  }
}

// payments
await page.goto("http://127.0.0.1:4173/#/payments", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await shot("15-payments-review");
// open first awaiting (should have receipt NVXM7QSP)
const card = page.locator("button").filter({ hasText: "NV" }).first();
if (await card.count()) {
  await card.click();
  await page.waitForTimeout(1500);
  await shot("16-payment-detail-receipt");
  const confirm = page.getByRole("button", { name: "确认开通 VIP" });
  if (await confirm.count()) {
    await confirm.click();
    await page.waitForTimeout(1200);
    await shot("17-payment-confirmed");
  }
}

// all payments tab
const allTab = page.getByRole("button", { name: "全部" });
if (await allTab.count()) {
  await allTab.click();
  await page.waitForTimeout(1000);
  await shot("18-payments-all");
}

// open a paid one for refund label? or rejected
// stats, audit, announce
await page.goto("http://127.0.0.1:4173/#/stats", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await shot("19-stats");

await page.goto("http://127.0.0.1:4173/#/audit", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await shot("20-audit");

await page.goto("http://127.0.0.1:4173/#/announce", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await shot("21-announce");

await page.goto("http://127.0.0.1:4173/#/reports", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await shot("22-reports");

await page.goto("http://127.0.0.1:4173/#/manage", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await shot("23-manage");

await page.goto("http://127.0.0.1:4173/#/me", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await shot("24-me");

// reject flow: need a new awaiting or use remaining. If none, skip.
await page.goto("http://127.0.0.1:4173/#/payments", { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
const leftover = page.locator("button").filter({ hasText: "待审核" });
// already on review tab. If a card remains:
const card2 = page.locator("article, button").filter({ hasText: /NV/ }).first();
console.log("done screenshots");
await browser.close();
