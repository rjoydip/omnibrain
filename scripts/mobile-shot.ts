import { chromium } from "playwright-core";

const API = "http://localhost:8787";
const WEB = "http://localhost:5173";
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
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
await page.goto(WEB, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await page.screenshot({ path: ".data/shots/08-mobile.png" });
await page
  .getByRole("button", { name: /Recall|Open recall/ })
  .first()
  .click();
await page.waitForTimeout(400);
await page.screenshot({ path: ".data/shots/20-mobile-recall.png" });
console.log("mobile shots updated");
await browser.close();
