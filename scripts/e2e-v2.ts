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

// --- Memory map: cursor + hover only on boxes -------------------------------
const canvas = page.locator("canvas");
const box = await canvas.boundingBox();
const cursorOf = () => canvas.evaluate((el) => getComputedStyle(el).cursor);
let crosshair = false;
if (box) {
  for (const fx of [0.2, 0.35, 0.5, 0.65, 0.8]) {
    for (const fy of [0.28, 0.42, 0.56, 0.7]) {
      await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
      if ((await cursorOf()) === "crosshair") {
        crosshair = true;
        break;
      }
    }
    if (crosshair) break;
  }
  await page.mouse.move(box.x + 6, box.y + box.height / 2);
  const outside = await cursorOf();
  const tooltip = await page.getByText(/week of/).count();
  console.log(
    "map: crosshair on box",
    crosshair,
    "| gutter cursor",
    outside,
    "| stray tooltip",
    tooltip,
  );
}
await page.screenshot({ path: ".data/shots/21-map-hover.png" });

// --- Inspector hide (close icon) -------------------------------------------
await page.locator("main .row").first().click();
await page.waitForTimeout(400);
const headingBefore = await page.getByText("Inspector", { exact: true }).count();
await page.getByRole("button", { name: "Hide inspector" }).click();
await page.waitForTimeout(300);
const headingAfter = await page.getByText("Inspector", { exact: true }).count();
const showButton = await page.getByRole("button", { name: "Show inspector" }).isVisible();
await page.screenshot({ path: ".data/shots/22-inspector-hidden.png" });
await page.getByRole("button", { name: "Show inspector" }).click();
await page.waitForTimeout(300);
const headingBack = await page.getByText("Inspector", { exact: true }).count();
const asideBack = await page.locator("aside").last().isVisible();
console.log(
  "inspector: before",
  headingBefore === 1,
  "| hidden",
  headingAfter === 0,
  "| restore button",
  showButton,
  "| reopened",
  headingBack === 1 && asideBack,
);

// --- Capture split button ----------------------------------------------------
await page.getByRole("button", { name: "More capture options" }).click();
await page.waitForTimeout(250);
const menuOpen = await page.getByRole("menuitem", { name: /Import bookmarks/ }).isVisible();
await page.screenshot({ path: ".data/shots/23-capture-menu.png" });
await page.keyboard.press("Escape");
console.log("capture menu opens", menuOpen);

// --- MCP: key row inline info, logs icon + modal -----------------------------
await page
  .locator('aside nav[aria-label="Primary"] button')
  .filter({ hasText: "MCP" })
  .first()
  .click();
await page.waitForTimeout(400);
await page.getByPlaceholder("Key name (e.g. Claude Desktop)").fill("Logs demo");
await page.getByRole("button", { name: "Create key" }).click();
await page.waitForTimeout(500);
await page.getByRole("button", { name: "Reveal API key" }).first().click();
await page.waitForTimeout(200);
const raw = await page
  .getByText(/^ob_[A-Za-z0-9_-]+$/)
  .first()
  .innerText();
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
    params: { clientInfo: { name: "Ridge", version: "2.1" } },
  },
});
await page.getByRole("button", { name: "View logs for Logs demo" }).click();
await page.waitForTimeout(700);
const modal = page.getByRole("dialog", { name: "MCP client logs" });
const modalOpen = await modal.isVisible();
const filterVisible = await page.getByLabel("Filter logs by key").isVisible();
const searchVisible = await page.getByLabel("Search logs").isVisible();
const detailVisible = await page.getByText("client connected").isVisible();
await page.screenshot({ path: ".data/shots/24-logs-modal.png" });
await page.getByLabel("Search logs").fill("ridge");
await page.waitForTimeout(300);
const filtered = await page.getByText("client connected").isVisible();
await page.getByLabel("Search logs").fill("zzzz");
await page.waitForTimeout(300);
const empty = await page.getByText(/No events match/).isVisible();
await page.screenshot({ path: ".data/shots/25-logs-search.png" });
await page.keyboard.press("Escape");
console.log(
  "logs modal: open",
  modalOpen,
  "| filter",
  filterVisible,
  "| search",
  searchVisible,
  "| detail",
  detailVisible,
  "| filtered",
  filtered,
  "| empty",
  empty,
);

// --- Settings data + danger zone ---------------------------------------------
await page
  .locator('aside nav[aria-label="Primary"] button')
  .filter({ hasText: "Settings" })
  .first()
  .click();
await page.waitForTimeout(400);
const dataTile = await page.getByText("Export everything").isVisible();
const danger = await page.getByText("Danger zone").isVisible();
await page.screenshot({ path: ".data/shots/26-settings-data.png" });
console.log("settings: export tile", dataTile, "| danger zone", danger);

// --- Accent still drives the whole UI ---------------------------------------
await page.getByRole("button", { name: "Accent Mint" }).click();
await page.waitForTimeout(250);
const colors = await page.evaluate(() => {
  const styles = getComputedStyle(document.documentElement);
  return {
    accent: styles.getPropertyValue("--accent").trim(),
    signal: styles.getPropertyValue("--signal").trim(),
  };
});
await page.screenshot({ path: ".data/shots/27-accent-mint.png" });
console.log("accent", colors, "matches", colors.accent === colors.signal);

console.log("errors", errors.length ? errors : "none");
await browser.close();
