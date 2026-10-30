import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const BASE = process.env.APP_BASE ?? "http://localhost:8088";
const PJ = process.env.PROJECT_ID ?? "9a6fa099-27a1-4f5c-9968-9b74481b53a7";
const WF = process.env.WORKFLOW_ID ?? "eab612da-8faf-425a-8d73-066e3f7a5c58";
const OUT = process.env.OUT_DIR ?? "/tmp/opencode/shots";
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/chromium",
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();

async function shot(name, { full = false } = {}) {
  await sleep(1000);
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 80, fullPage: full });
  console.log("✔", name, "·", page.url());
}
async function setField(sel, value) {
  await page.$eval(
    sel,
    (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    value,
  );
}
async function waitFor(sel, ms = 8000) {
  try { await page.waitForSelector(sel, { timeout: ms }); } catch { /* seguir */ }
}

async function clickTab(label) {
  await page.evaluate((l) => {
    const b = [...document.querySelectorAll('button[role="tab"], .tabs button')].find((x) => x.textContent.trim().startsWith(l));
    if (b) b.click();
  }, label);
  await sleep(1000);
}

await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
await shot("01-login");
await setField('input[type="email"]', "demo@factoria.dev");
await setField('input[type="password"]', "demo12345");
await page.click('button[type="submit"]');
await page.waitForFunction(() => location.pathname !== "/login", { timeout: 15000 });
await shot("02-proyectos");

await page.goto(`${BASE}/providers`, { waitUntil: "networkidle2" }); await shot("03-proveedores");
await page.goto(`${BASE}/subagents`, { waitUntil: "networkidle2" }); await shot("04-subagentes");
await page.goto(`${BASE}/workflows`, { waitUntil: "networkidle2" }); await shot("05-flujos", { full: true });
await page.goto(`${BASE}/workflows/${WF}`, { waitUntil: "networkidle2" }); await waitFor(".react-flow__node"); await sleep(1500); await shot("06-editor");

await page.goto(`${BASE}/projects/${PJ}`, { waitUntil: "networkidle2" });
await waitFor("h1"); await sleep(1800); await shot("07-proyecto-general", { full: true });
await clickTab("Funcionalidades"); await shot("08-funcionalidades");
await clickTab("Contratos"); await shot("09-contratos");
await clickTab("Documentación"); await shot("10-documentacion", { full: true });
await clickTab("Flujo"); await waitFor(".react-flow__node"); await sleep(1500); await shot("11-flujo");
await clickTab("Archivos"); await shot("12-archivos");
await clickTab("Ejecuciones"); await waitFor(".log .line", 9000); await sleep(800); await shot("13-ejecuciones", { full: true });
await clickTab("Asistente"); await shot("14-asistente");

await browser.close();
console.log("Listo.");
