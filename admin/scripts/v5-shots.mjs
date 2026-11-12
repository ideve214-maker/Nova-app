import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const out = "/workspace/nova-admin/screenshots/v5";
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
page.on("pageerror", (err) => console.log("PAGEERROR", err.message));
page.on("console", (msg) => { if (msg.type() === "error") console.log("BROWSER", msg.type(), msg.text()); });

async function shot(name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
  console.log("shot", name, await page.evaluate(() => location.hash));
}

await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle", timeout: 30000 });
await page.evaluate(() => {
  try {
    localStorage.clear();
    sessionStorage.clear();
    // Override baked-in production host so this preview uses the same-origin /api proxy.
    localStorage.setItem(
      "nova-admin-api-config-v1",
      JSON.stringify({ baseUrl: "http://127.0.0.1:8787", timeoutMs: 8000, token: "", endpoints: {} }),
    );
  } catch {}
});
await page.reload({ waitUntil: "networkidle", timeout: 30000 });
await page.waitForSelector("text=NOVA 管理端", { timeout: 12000 });

await page.locator('input[placeholder="管理员账号"]').fill("admin");
await page.locator('input[placeholder="密码"]').fill("NovaAdm1n9");
await page.getByRole("button", { name: "登录" }).click();
await page.waitForSelector("text=管理后台", { timeout: 20000 });
await page.waitForTimeout(1500);

await page.goto("http://127.0.0.1:4173/#/communities", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.getByText("清晨散步").first().waitFor({ timeout: 8000 });
await shot("communities");

await page.goto("http://127.0.0.1:4173/#/announce", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.getByText("维护通知").first().waitFor({ timeout: 8000 });
await shot("announcements");

await page.goto("http://127.0.0.1:4173/#/content", { waitUntil: "networkidle" });
await page.waitForTimeout(600);
const commentTab = page.getByRole("button", { name: "评论" }).first();
await commentTab.click();
await page.waitForTimeout(800);
const threadBtn = page.getByText("查看楼层").first();
if (await threadBtn.count()) {
  await threadBtn.click();
  await page.waitForTimeout(700);
}
await shot("nested-comment");

await page.goto("http://127.0.0.1:4173/#/blockwords", { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.getByText("加微信办证").first().waitFor({ timeout: 8000 });
await shot("blockwords");

await browser.close();
console.log("done", out);
