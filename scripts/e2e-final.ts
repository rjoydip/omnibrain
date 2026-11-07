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

// 1. Rail source filtering
await page.locator("aside nav button").filter({ hasText: "Web" }).first().click();
await page.waitForTimeout(400);
const hasAllTime = await page.getByText(/Web · all time/).count();
console.log("rail source filter applied", hasAllTime > 0);
await page.screenshot({ path: ".data/shots/15-source-filter.png" });

// 2. Atlas drag selection
const canvas = page.locator("canvas");
const box = await canvas.boundingBox();
if (box) {
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.7, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
}
const filterText = await page
  .locator("button")
  .filter({ hasText: /–/ })
  .first()
  .innerText()
  .catch(() => "missing");
console.log("drag filter", filterText);
await page.screenshot({ path: ".data/shots/16-drag-filter.png" });

// 3. Inspector drag resize
const clear = page.getByRole("button", { name: /Clear filters/ });
if (await clear.count()) await clear.first().click();
await page.waitForTimeout(300);
await page.locator("main .row").first().click();
await page.waitForTimeout(300);
const aside = page.locator("aside").last();
const before = await aside.evaluate((el) => el.clientWidth);
const handle = page.getByRole("separator", { name: "Resize inspector" });
const hb = await handle.boundingBox();
if (hb) {
  await page.mouse.move(hb.x + 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x - 140, hb.y + hb.height / 2, { steps: 8 });
  await page.mouse.up();
}
await page.waitForTimeout(300);
const after = await aside.evaluate((el) => el.clientWidth);
console.log("inspector drag", before, "->", after);
await page.screenshot({ path: ".data/shots/17-inspector-drag.png" });

// 4. Accent affects signal/logo/buttons
await page
  .locator('aside nav[aria-label="Primary"] button')
  .filter({ hasText: "Settings" })
  .first()
  .click();
await page.waitForTimeout(300);
const signalBefore = await page.evaluate(() =>
  getComputedStyle(document.documentElement).getPropertyValue("--signal").trim(),
);
await page.getByRole("button", { name: "Accent Amber" }).click();
await page.waitForTimeout(250);
const themeColors = await page.evaluate(() => {
  const styles = getComputedStyle(document.documentElement);
  const logo = document.querySelector("aside svg");
  return {
    accent: styles.getPropertyValue("--accent").trim(),
    signal: styles.getPropertyValue("--signal").trim(),
    logo: logo ? getComputedStyle(logo).color : null,
  };
});
console.log("accent colors", signalBefore, "->", themeColors);
await page.screenshot({ path: ".data/shots/18-accent-amber.png" });

// 5. MCP key reveal + logs + Kirari
await page
  .locator('aside nav[aria-label="Primary"] button')
  .filter({ hasText: "MCP" })
  .first()
  .click();
await page.waitForTimeout(400);
console.log("kirari blocks", await page.locator(".kirari").count());
console.log("kirari tokens", await page.locator(".kirari-string").count());
await page.getByPlaceholder("Key name (e.g. Claude Desktop)").fill("Final test");
await page.getByRole("button", { name: "Create key" }).click();
await page.waitForTimeout(600);
console.log("key masked", (await page.getByText(/••••/).count()) > 0);
const reveal = page.getByRole("button", { name: "Reveal API key" }).first();
await reveal.click();
await page.waitForTimeout(200);
const raw = await page
  .getByText(/^ob_[A-Za-z0-9_-]+$/)
  .first()
  .innerText();
console.log("key revealed", raw.startsWith("ob_"));
if (raw) {
  await context.request.post(`${API}/mcp`, {
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${raw}`,
      origin: WEB,
    },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "Final", version: "1.0" } },
    },
  });
  await page.getByRole("button", { name: "logs" }).first().click();
  await page.waitForTimeout(600);
}
console.log("client log", (await page.getByText("client connected").count()) > 0);
await page.screenshot({ path: ".data/shots/19-keys-kirari.png" });

console.log("errors", errors.length ? errors : "none");
await browser.close();
