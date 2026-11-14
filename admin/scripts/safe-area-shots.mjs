import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const out = "/workspace/nova-admin/screenshots/v3-safe";
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

async function applyInsets() {
  await page.addStyleTag({
    content: `:root{--nova-safe-top:47px !important;--nova-safe-bottom:34px !important;--nova-safe-left:0px;--nova-safe-right:0px;}`,
  });
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--nova-safe-top", "47px", "important");
    document.documentElement.style.setProperty("--nova-safe-bottom", "34px", "important");
  });
  await page.waitForTimeout(50);
}

async function overlays() {
  await applyInsets();
  await page.evaluate(() => {
    const old = document.getElementById("nova-sim-overlays");
    if (old) old.remove();
    const wrap = document.createElement("div");
    wrap.id = "nova-sim-overlays";
    wrap.style.cssText = "position:fixed;inset:0;z-index:2147483646;pointer-events:none;";
    wrap.innerHTML = `
      <div style="position:absolute;top:0;left:0;right:0;height:47px;background:rgba(20,16,32,.42);display:flex;align-items:flex-end;justify-content:center;">
        <div style="position:absolute;top:10px;left:50%;transform:translateX(-50%);width:118px;height:37px;border-radius:19px;background:#111;"></div>
        <span style="color:#fff;font:10px/1 -apple-system,sans-serif;margin-bottom:4px;opacity:.9;">sim inset 47 / 34</span>
      </div>
      <div style="position:absolute;bottom:0;left:0;right:0;height:34px;background:rgba(20,16,32,.42);display:flex;align-items:center;justify-content:center;">
        <div style="width:128px;height:5px;border-radius:3px;background:#fff;opacity:.85;"></div>
      </div>
    `;
    document.body.appendChild(wrap);
  });
}

await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle", timeout: 30000 });
await page.evaluate(() => {
  try { localStorage.clear(); sessionStorage.clear(); } catch {}
});
await page.reload({ waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(900);
await page.waitForSelector("text=VEXO 管理端", { timeout: 10000 });
await overlays();
await page.waitForTimeout(200);
await page.screenshot({ path: `${out}/login.png`, fullPage: false });
console.log("login hash", await page.evaluate(() => location.hash));

// open 设置服务器 sheet to verify sheet bottom inset
await page.getByRole("button", { name: "设置服务器" }).click();
await page.waitForTimeout(400);
await overlays();
await page.screenshot({ path: `${out}/login-sheet.png`, fullPage: false });
await page.getByRole("button", { name: "关闭" }).click();
await page.waitForTimeout(200);

await page.locator('input[placeholder="密码"]').first().fill("nova1234");
await page.getByRole("button", { name: "登录" }).click();
await page.waitForSelector("text=管理后台", { timeout: 10000 });
await page.waitForTimeout(1500);
const hashAfterLogin = await page.evaluate(() => location.hash);
console.log("home hash", hashAfterLogin);
await overlays();
await page.screenshot({ path: `${out}/home.png`, fullPage: false });
console.log("---- HOME ----\n", (await page.locator("body").innerText()).slice(0, 400));

await page.getByRole("button", { name: /用户管理/ }).first().click();
await page.waitForSelector("text=用户管理", { timeout: 8000 });
await page.waitForTimeout(400);
const hashUsers = await page.evaluate(() => location.hash);
console.log("users hash", hashUsers);
await overlays();
await page.screenshot({ path: `${out}/users.png`, fullPage: false });

// Confirm login persistence: reload, should stay authed
await page.reload({ waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(1200);
const afterReload = await page.locator("body").innerText();
const stillIn = afterReload.includes("管理后台") || afterReload.includes("用户管理") || afterReload.includes("暂时没有数据");
const backToLogin = afterReload.includes("本机操作员登录") && !afterReload.includes("管理后台") && !afterReload.includes("用户管理");
console.log("after reload still authed?", stillIn, "back to login?", backToLogin, "hash", await page.evaluate(() => location.hash));
await overlays();
await page.screenshot({ path: `${out}/reload-persisted.png`, fullPage: false });

const metrics = await page.evaluate(() => {
  const top = getComputedStyle(document.documentElement).getPropertyValue("--nova-safe-top");
  const bot = getComputedStyle(document.documentElement).getPropertyValue("--nova-safe-bottom");
  const header = document.querySelector(".nova-topbar, header");
  const tab = document.querySelector(".nova-tabbar");
  const hr = header ? header.getBoundingClientRect() : null;
  const tr = tab ? tab.getBoundingClientRect() : null;
  return {
    top, bot,
    headerHeight: hr && Math.round(hr.height),
    headerTop: hr && Math.round(hr.top),
    tabBottom: tr && Math.round(tr.bottom),
    tabHeight: tr && Math.round(tr.height),
    innerHeight: window.innerHeight,
  };
});
console.log("metrics", metrics);

await browser.close();
