import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const out = "/workspace/nova-admin/screenshots/v6-xinglan";
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--disable-dev-shm-usage", "--no-sandbox"],
});

async function contextWith(colorScheme) {
  return browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    colorScheme,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    locale: "zh-CN",
  });
}

async function prepare(page, theme) {
  page.setDefaultTimeout(20000);
  page.on("pageerror", (err) => console.log("PAGEERROR", err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("BROWSER", msg.text());
  });
  await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle", timeout: 30000 });
  await page.evaluate((theme) => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem("nova-admin-theme", theme);
      localStorage.setItem(
        "nova-admin-api-config-v1",
        JSON.stringify({ baseUrl: "http://127.0.0.1:8787", timeoutMs: 8000, token: "", endpoints: {} }),
      );
    } catch {}
  }, theme);
  await page.reload({ waitUntil: "networkidle", timeout: 30000 });
  await page.waitForSelector("text=管理端", { timeout: 12000 });
}

async function shot(page, name) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
  console.log("shot", name, await page.evaluate(() => document.documentElement.getAttribute("data-theme") + " " + location.hash));
}

const dark = await contextWith("dark");
const page = await dark.newPage();
await prepare(page, "dark");
await shot(page, "login-dark");

let loggedIn = false;
try {
  await page.locator('input[placeholder="管理员账号"]').fill("admin");
  await page.locator('input[placeholder="密码"]').fill("NovaAdm1n9");
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForSelector("text=管理后台", { timeout: 15000 });
  await page.waitForTimeout(800);
  loggedIn = true;
  console.log("logged in");
} catch (err) {
  console.log("login failed, staying on login:", err.message);
}

if (loggedIn) {
  await page.goto("http://127.0.0.1:4173/#/users", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await shot(page, "users-dark");
} else {
  await shot(page, "users-dark"); // still a frame, but likely login
}

await dark.close();

const light = await contextWith("light");
const pageL = await light.newPage();
if (loggedIn) {
  await prepare(pageL, "light");
  try {
    await pageL.locator('input[placeholder="管理员账号"]').fill("admin");
    await pageL.locator('input[placeholder="密码"]').fill("NovaAdm1n9");
    await pageL.getByRole("button", { name: "登录" }).click();
    await pageL.waitForSelector("text=管理后台", { timeout: 15000 });
    await pageL.goto("http://127.0.0.1:4173/#/users", { waitUntil: "networkidle" });
    await pageL.waitForTimeout(800);
    await shot(pageL, "users-light");
  } catch (err) {
    console.log("light login failed:", err.message);
    await shot(pageL, "users-light");
  }
} else {
  await prepare(pageL, "light");
  await shot(pageL, "users-light");
}

await light.close();
await browser.close();
console.log("done", out);
