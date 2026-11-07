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
page.on("console", (m) => console.log("console", m.type(), m.text()));
page.on("pageerror", (e) => console.log("pageerror", e.message));
page.on("response", async (res) => {
  if (res.url().includes("/keys")) {
    console.log("response", res.status(), res.request().method(), res.url());
    console.log("body", (await res.text()).slice(0, 500));
  }
});
await page.goto(WEB, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1000);
await page
  .locator('aside nav[aria-label="Primary"] button')
  .filter({ hasText: "MCP" })
  .first()
  .click();
await page.waitForTimeout(600);
await page.getByRole("button", { name: "Create key" }).click();
await page.waitForTimeout(1500);
const toasts = await page.locator('[role="status"] > div').allInnerTexts();
console.log("toasts", toasts);
await page.screenshot({ path: ".data/shots/key-repro.png" });
await browser.close();
