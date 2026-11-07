import { chromium } from "playwright-core";

const API = "http://localhost:8787";
const WEB = "http://localhost:5173";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const otp = await context.request.post(`${API}/api/v1/auth/request-otp`, {
  data: { email: "demo@omnibrain.local" },
  headers: { origin: WEB },
});
const { dev_code } = (await otp.json()) as { dev_code: string };
await context.request.post(`${API}/api/v1/auth/verify`, {
  data: { email: "demo@omnibrain.local", code: dev_code },
  headers: { origin: WEB },
});
const page = await context.newPage();
const logs: string[] = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(WEB, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
const info = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  if (!c) return { canvas: false };
  const wrap = c.parentElement;
  const ctx = c.getContext("2d");
  const data = ctx?.getImageData(0, 0, Math.min(c.width, 200), Math.min(c.height, 200)).data;
  let nonTransparent = 0;
  if (data) for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) nonTransparent++;
  return {
    canvas: true,
    css: { w: c.clientWidth, h: c.clientHeight },
    bitmap: { w: c.width, h: c.height },
    wrap: wrap ? { w: wrap.clientWidth, h: wrap.clientHeight } : null,
    signal: getComputedStyle(document.documentElement).getPropertyValue("--signal"),
    nonTransparent,
  };
});
console.log(JSON.stringify(info, null, 2));
console.log(logs.join("\n") || "no console output");
await browser.close();
