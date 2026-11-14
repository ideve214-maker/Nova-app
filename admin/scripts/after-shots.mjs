import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const out = "/workspace/nova-admin/screenshots/after";
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

await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle", timeout: 30000 });
await page.evaluate(() => {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {}
});
await page.reload({ waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(800);

const enter = page.getByRole("button", { name: /进入/ });
if (await enter.count()) {
  try {
    await enter.click({ timeout: 1000 });
  } catch {}
}
await page.waitForSelector("text=VEXO 管理端", { timeout: 10000 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/login.png`, fullPage: false });
console.log("login h1:", await page.locator("h1").first().innerText());

await page.locator('input[placeholder="密码"]').first().fill("nova1234");
await page.getByRole("button", { name: "登录" }).click();
await page.waitForSelector("text=管理后台", { timeout: 10000 });
await page.waitForTimeout(2800);
await page.screenshot({ path: `${out}/home.png`, fullPage: false });
console.log("---- HOME ----\n", (await page.locator("body").innerText()).slice(0, 800));

await page.getByRole("button", { name: /用户管理/ }).first().click();
await page.waitForSelector("text=用户管理", { timeout: 8000 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/users.png`, fullPage: false });
console.log("---- USERS ----\n", (await page.locator("body").innerText()).slice(0, 800));

const overflow = await page.evaluate(() => ({
  sw: document.documentElement.scrollWidth,
  cw: document.documentElement.clientWidth,
  iw: window.innerWidth,
}));
console.log("overflow", overflow);

await browser.close();
