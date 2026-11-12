import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const out = "/workspace/nova-admin/screenshots/v7-m61";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--disable-dev-shm-usage", "--no-sandbox"],
});

const context = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  colorScheme: "dark",
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  locale: "zh-CN",
});

const page = await context.newPage();
page.setDefaultTimeout(20000);
page.on("pageerror", (err) => console.log("PAGEERROR", err.message));
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("BROWSER", msg.text());
});

await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle", timeout: 30000 });
await page.evaluate(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("nova-admin-theme", "dark");
  localStorage.setItem(
    "nova-admin-api-config-v1",
    JSON.stringify({ baseUrl: "http://127.0.0.1:8787", timeoutMs: 8000, token: "", endpoints: {} }),
  );
});
await page.reload({ waitUntil: "networkidle", timeout: 30000 });
await page.waitForSelector("text=管理端", { timeout: 12000 });

await page.locator('input[placeholder="管理员账号"]').fill("agen");
await page.locator('input[placeholder="密码"]').fill("NovaAdmin61");
await page.getByRole("button", { name: "登录" }).click();
await page.waitForSelector("text=管理后台", { timeout: 15000 });
await page.waitForTimeout(800);

await page.goto("http://127.0.0.1:4173/#/events", { waitUntil: "networkidle" });
await page.waitForSelector("text=安全事件", { timeout: 10000 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/events.png`, fullPage: false });
console.log("shot events");

await page.goto("http://127.0.0.1:4173/#/appeals", { waitUntil: "networkidle" });
await page.waitForSelector("text=申诉处理", { timeout: 10000 });
// default tab is 待处理
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/appeals.png`, fullPage: false });
console.log("shot appeals");

await browser.close();
console.log("done", out);
