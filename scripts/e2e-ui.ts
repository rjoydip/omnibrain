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
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.goto(WEB, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);

const width = () =>
  page
    .locator("aside.lg\\:flex")
    .last()
    .evaluate((el) => el.clientWidth);
console.log("inspector width before", await width());
await page.locator("main .row").first().click();
await page.waitForTimeout(200);
await page.getByRole("button", { name: "Expand inspector" }).click();
await page.waitForTimeout(350);
console.log("inspector width after", await width());
console.log("accent", await page.evaluate(() => document.documentElement.dataset.accent));
await page.screenshot({ path: ".data/shots/12-expanded.png" });

// theme icon cycle
const before = await page.evaluate(() => document.documentElement.dataset.theme);
await page.getByRole("button", { name: /Change theme/ }).click();
await page.waitForTimeout(250);
const after = await page.evaluate(() => document.documentElement.dataset.theme);
console.log("theme", before, "->", after);

// accent palette
await page
  .locator('aside nav[aria-label="Primary"] button')
  .filter({ hasText: "Settings" })
  .first()
  .click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: "Accent Coral" }).click();
await page.waitForTimeout(300);
console.log("accent after", await page.evaluate(() => document.documentElement.dataset.accent));
await page.screenshot({ path: ".data/shots/13-settings-accent.png" });

// MCP key + logs
await page
  .locator('aside nav[aria-label="Primary"] button')
  .filter({ hasText: "MCP" })
  .first()
  .click();
await page.waitForTimeout(400);
const create = page.getByRole("button", { name: "Create key" });
console.log("create disabled with empty name", await create.isDisabled());
await page.getByPlaceholder("Key name (e.g. Claude Desktop)").fill("Playwright client");
await create.click();
await page
  .getByText("API key created")
  .waitFor({ timeout: 10_000 })
  .catch(() => undefined);
const key = await page.locator("code").filter({ hasText: /^ob_/ }).first().innerText();
console.log("raw key shown", key.startsWith("ob_"));
await context.request.post(`${API}/mcp`, {
  headers: { "content-type": "application/json", authorization: `Bearer ${key}`, origin: WEB },
  data: {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { clientInfo: { name: "Playwright", version: "1.0" } },
  },
});
await page.getByRole("button", { name: "logs" }).first().click();
await page.waitForTimeout(800);
console.log(
  "log text",
  await page
    .locator("li")
    .filter({ hasText: "client connected" })
    .first()
    .innerText()
    .catch(() => "missing"),
);
await page.screenshot({ path: ".data/shots/14-mcp-logs.png" });

console.log("errors", errors.length ? errors : "none");
await browser.close();
