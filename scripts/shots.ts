import { chromium } from "playwright-core";

const API = "http://localhost:8787";
const WEB = "http://localhost:5173";
const OUT = ".data/shots";

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
context.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});

async function login(ctx: typeof context) {
  const otp = await ctx.request.post(`${API}/api/v1/auth/request-otp`, {
    data: { email: "demo@omnibrain.local" },
    headers: { origin: WEB },
  });
  const { dev_code } = (await otp.json()) as { dev_code: string };
  const verify = await ctx.request.post(`${API}/api/v1/auth/verify`, {
    data: { email: "demo@omnibrain.local", code: dev_code },
    headers: { origin: WEB },
  });
  if (verify.status() !== 200) throw new Error(`login failed: ${verify.status()}`);
}
await login(context);

const page = await context.newPage();
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
const nav = (label: string) =>
  page.locator('aside nav[aria-label="Primary"] button').filter({ hasText: label }).first().click();

await page.goto(WEB, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1300);
await page.screenshot({ path: `${OUT}/01-knowledge.png` });

await page.keyboard.press("Control+K");
await page.waitForTimeout(300);
await page.keyboard.type("vectorize", { delay: 25 });
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/02-recall.png` });
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

await nav("App Store");
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/03-apps.png` });

await nav("Import");
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/04-import.png` });

await nav("MCP");
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/05-mcp.png` });

await nav("Settings");
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/06-settings.png` });

// Paper theme, back to knowledge, select first item.
await nav("Knowledge");
await page.locator('aside button[aria-label^="Switch theme"]').click();
await page.waitForTimeout(400);
await page.locator("main .row").first().click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/07-paper-inspector.png` });

// Mobile: reuse the authenticated desktop session.
const state = await context.storageState();
const mobile = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  storageState: state,
});
const mPage = await mobile.newPage();
await mPage.goto(WEB, { waitUntil: "domcontentloaded" });
await mPage.waitForTimeout(1300);
await mPage.screenshot({ path: `${OUT}/08-mobile.png` });
await mPage.locator("main .row").first().click();
await mPage.waitForTimeout(500);
await mPage.screenshot({ path: `${OUT}/09-mobile-inspector.png` });

// Auth screen without cookies
const fresh = await browser.newContext({ viewport: { width: 1280, height: 820 } });
const authPage = await fresh.newPage();
await authPage.goto(WEB, { waitUntil: "domcontentloaded" });
await authPage.waitForTimeout(900);
await authPage.screenshot({ path: `${OUT}/10-auth.png` });

console.log("console errors:", errors.length ? errors : "none");
await browser.close();
