/**
 * OLED Saver - black out or dim any screen, one key per monitor, to protect OLED panels from burn-in.
 *
 * How it works: helper.ps1 puts one borderless always-on-top window over a screen. Black = opaque window (the screen
 * stays on and connected, so Windows moves no window; a click on it brings the screen back). Dimming = the same
 * window, see-through and click-through. If the plugin or the helper stops, every veil disappears.
 *
 * Actions (placed by position, like every plugin of this workspace):
 *   key   - slots 0-3 and 7-9: screens 1-4 and 5-7 (left to right): black out / bring back. Slot 4: Focus (black out
 *           every screen but the one with the mouse). Slot 5: All. Slot 6: Auto on / off.
 *   knob  - 1: brightness of the picked screen (press: black out / back)  2: auto delay (press: on / off)
 *           3: pick a screen (press: show its number on every screen)    4: Scene Zapper when it is installed.
 *   strip - the touchbar: brightness, auto delay, and a map of the screens. Tap = black out / bring back the picked screen
 *           (StreamDock gives no tap position, so the screen is picked with knob 3).
 * Auto: a screen goes black when the mouse has not been on it, no window on it has had the focus and its picture has not
 * changed for the chosen time. It comes back when the mouse or the focus comes to it.
 *
 * State: %APPDATA%\cherki-oledsaver\state.json (auto delay only: a screen is never left black across a restart).
 * Log: oledsaver.log next to the plugin (no private data in it).
 * Tests: OLEDSAVER_STATE (state file), OLEDSAVER_LANG=fr|en|zh, OLEDSAVER_HELPER (a fake helper script run by node),
 *        OLEDSAVER_AUTO_MS (length of "1 minute"), OLEDSAVER_TICK_MS, CHANNELS_HUB (scene-hop). See scripts/test-e2e.cjs.
 * Shared rules and pitfalls: docs/techniques-streamdock.md at the root of the workspace.
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");
const hop = require("./scene-hop");   // knob 4 press opens Scene Zapper, when it is installed
const { LANG, T } = require("./i18n");

let Resvg = null;
try { ({ Resvg } = require("@resvg/resvg-js")); } catch { /* SVG fallback */ }
const { safeSvg } = require("./svg-safe");   // resvg would abort the plugin on some SVGs: see svg-safe.js

function arg(n) { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; }
const PORT = arg("-port"), PLUGIN_UUID = arg("-pluginUUID"), REGISTER_EVENT = arg("-registerEvent");
const LOG_FILE = path.join(__dirname, "..", "oledsaver.log");
let logLines = 0;
function log(...a) { if (logLines++ < 2000) try { fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${a.join(" ")}\n`); } catch {} }
try { fs.writeFileSync(LOG_FILE, ""); } catch {}

// ----- rendering: texts drawn once into cached layers (fonts cost far more than shapes) -----
const FONT_DIR = path.join(process.env.WINDIR || "C:\\Windows", "Fonts");
const fontFiles = (names) => names.map((f) => path.join(FONT_DIR, f)).filter((f) => fs.existsSync(f));
const FONTS_LATIN = fontFiles(["segoeui.ttf", "segoeuib.ttf", "seguisb.ttf", "seguisym.ttf"]);
const FONTS_CJK = [...FONTS_LATIN, ...fontFiles(["msyh.ttc", "msyhbd.ttc"])];
const FONT = "Segoe UI, Microsoft YaHei, Arial";
const CJK = /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/;
const pngUrl = (buf) => `data:image/png;base64,${buf.toString("base64")}`;
const svgUrl = (svg) => `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
const textLayers = new Map();
function textLayer(rootAttrs, texts) {
  const key = rootAttrs + texts;
  let url = textLayers.get(key);
  if (url === undefined) {
    const png = new Resvg(safeSvg(`<svg ${rootAttrs}>${texts}</svg>`), { font: { loadSystemFonts: false, fontFiles: CJK.test(texts) ? FONTS_CJK : FONTS_LATIN, defaultFontFamily: "Segoe UI" } }).render().asPng();
    url = pngUrl(png);
    if (textLayers.size > 300) textLayers.delete(textLayers.keys().next().value);
    textLayers.set(key, url);
  }
  return url;
}
// Texts go to their own cached layer drawn ABOVE the shapes: never put a <text> inside a transformed <g>.
function toPng(svg) {
  if (!Resvg) return null;
  const root = /^<svg([^>]*)>/.exec(svg);
  const texts = svg.match(/<text\b[^>]*>[\s\S]*?<\/text>/g);
  let frame = svg;
  if (root && texts) {
    const w = /\bwidth="([\d.]+)"/.exec(root[1])[1], h = /\bheight="([\d.]+)"/.exec(root[1])[1];
    const vb = /\bviewBox="([^"]+)"/.exec(root[1]);
    const [vx, vy, vw, vh] = vb ? vb[1].split(/\s+/).map(Number) : [0, 0, Number(w), Number(h)];
    frame = svg.replace(/<text\b[^>]*>[\s\S]*?<\/text>/g, "").replace(/<\/svg>\s*$/,
      `<image href="${textLayer(root[1], texts.join(""))}" x="${vx}" y="${vy}" width="${vw}" height="${vh}" preserveAspectRatio="none"/></svg>`);
  }
  return new Resvg(safeSvg(frame), { font: { loadSystemFonts: false } }).render().asPng();
}

// ----- remembered state: only the auto delay (a screen is never left black across a restart) -----
const STATE_FILE = process.env.OLEDSAVER_STATE || path.join(process.env.APPDATA || __dirname, "cherki-oledsaver", "state.json");
const AUTO_STEPS = [0, 1, 2, 3, 5, 10, 15, 30, 60];   // minutes, 0 = off
let S = {};
try { S = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) || {}; } catch {}
S.autoMin = AUTO_STEPS.includes(S.autoMin) ? S.autoMin : 0;
S.lastAuto = AUTO_STEPS.includes(S.lastAuto) && S.lastAuto > 0 ? S.lastAuto : 10;
let saveTimer = null;
function save() {   // at most once a second
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; try { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(S, null, 1)); } catch {} }, 1000);
}

// ----- screens: what the helper says, plus what the plugin decided -----
const AUTO_MS = Number(process.env.OLEDSAVER_AUTO_MS) || 60000;   // length of "1 minute"
const TICK_MS = Number(process.env.OLEDSAVER_TICK_MS) || 2000;
const ACTIVITY_CELLS = 8;   // of 48 x 27: fewer changed cells = a clock tick or a blinking caret, not activity
const SCREEN_SLOTS = [0, 1, 2, 3, 7, 8, 9], SLOT_FOCUS = 4, SLOT_ALL = 5, SLOT_AUTO = 6;
let screens = [];                 // [{ device, x, y, w, h, primary, level }] left to right
let cursorDev = "", fgDev = "";   // screen with the mouse / with the focused window
let helperUp = false;             // the helper answered at least once
let selIdx = 0;                   // picked screen (knob 3)
const lv = new Map();             // device -> level 0-100 (0 normal, 1-99 dimmed, 100 black)
const by = new Map();             // device -> "manual" | "auto" while black
const before = new Map();         // device -> level to give back when a black screen is restored
const lastActive = new Map();     // device -> ms of the last sign of life (auto)
const touched = new Map();        // device -> ms of the last order we sent (a slower list answer must not undo it)
const level = (dev) => lv.get(dev) || 0;
const isBlack = (dev) => level(dev) >= 100;
const selDev = () => screens[Math.min(selIdx, screens.length - 1)]?.device || "";
const anyDark = () => [...lv.values()].some((v) => v > 0);

// ----- helper.ps1: one PowerShell process, one JSON command per line -----
let helper = null, helperBuf = "", reqN = 0, helperRestarts = 0, wantHelper = false, failures = 0;
const pending = new Map();
function startHelper() {
  wantHelper = true;
  if (helper) return;
  // OLEDSAVER_HELPER (tests only): a fake helper script run by node instead of the real screens
  helper = process.env.OLEDSAVER_HELPER
    ? spawn(process.execPath, [process.env.OLEDSAVER_HELPER], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] })
    : spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "helper.ps1")], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const me = helper;
  helperBuf = "";
  helper.stdout.setEncoding("utf8");
  helper.stdout.on("data", (d) => {
    helperBuf += d; let nl;
    while ((nl = helperBuf.indexOf("\n")) >= 0) {
      const line = helperBuf.slice(0, nl).trim(); helperBuf = helperBuf.slice(nl + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      failures = 0;
      if (m.t === "error") log("helper error", m.err);
      else if (m.t === "click") onClick(m.device);
      else if (m.t === "screens") refresh();
      const p = pending.get(m.n); if (p && m.n) { pending.delete(m.n); clearTimeout(p.timer); p.resolve(m); }
    }
  });
  helper.stderr.on("data", (d) => log("helper stderr", String(d).slice(0, 300)));
  helper.on("exit", (c) => {
    log("helper exit", c);
    if (helper !== me) return;
    helper = null; helperUp = false;
    for (const p of pending.values()) { clearTimeout(p.timer); p.resolve(null); }
    pending.clear();
    // the veils went away with the helper: forget them
    lv.clear(); by.clear(); before.clear(); screens = [];
    renderAll(); ensureTimers();
    if (wantHelper && ++helperRestarts <= 3) setTimeout(() => { if (wantHelper) { startHelper(); refresh(); } }, 3000);
  });
}
const CALL_MS = Number(process.env.OLEDSAVER_CALL_MS) || 15000;
function call(cmd, timeout = CALL_MS) {
  return new Promise((resolve) => {
    if (!helper) return resolve(null);
    const n = ++reqN;
    pending.set(n, { resolve, timer: setTimeout(() => {
      pending.delete(n); resolve(null);
      // two orders without any answer: the helper is stuck, restart it (its veils go away with it)
      if (++failures >= 2 && helper) { log("helper stuck, restarting"); failures = 0; try { helper.kill(); } catch {} }
    }, timeout) });
    try { helper.stdin.write(JSON.stringify({ ...cmd, n }) + "\n"); } catch { /* exit handler cleans up */ }
  });
}
function stopIfIdle() {   // nothing shown, nothing black, no auto: no reason to keep a PowerShell alive
  if (contexts.size || S.autoMin > 0 || anyDark()) return;
  wantHelper = false;
  try { helper?.stdin.end(); } catch {}
}

async function refresh(sample = false) {
  const sentAt = Date.now();
  const r = await call({ cmd: "list", sample });
  if (!r || !Array.isArray(r.screens)) return false;
  helperUp = true; helperRestarts = 0;
  screens = r.screens; cursorDev = r.cursor || ""; fgDev = r.fg || "";
  const present = new Set(screens.map((s) => s.device));
  for (const dev of [...lv.keys()]) if (!present.has(dev)) { lv.delete(dev); by.delete(dev); before.delete(dev); lastActive.delete(dev); touched.delete(dev); }
  for (const s of screens) {
    if ((touched.get(s.device) || 0) > sentAt) continue;   // we gave a newer order than this answer knows
    lv.set(s.device, s.level);
    if (s.level < 100) by.delete(s.device);
    if (!lastActive.has(s.device)) lastActive.set(s.device, Date.now());
  }
  if (selIdx >= screens.length) selIdx = Math.max(0, screens.length - 1);
  renderAll();
  return r;
}

function setLevel(dev, to, who) {
  to = Math.max(0, Math.min(100, Math.round(to)));
  const cur = level(dev);
  if (to >= 100 && cur < 100) before.set(dev, cur);
  if (to < 100) before.delete(dev);
  lv.set(dev, to); touched.set(dev, Date.now());
  if (to >= 100) by.set(dev, who || "manual"); else by.delete(dev);
  lastActive.set(dev, Date.now());   // the idle clock restarts
  call({ cmd: "level", device: dev, level: to }, 5000);
  ensureTimers(); renderAll();
}
const restore = (dev) => setLevel(dev, before.get(dev) || 0);
function toggle(dev) { if (!dev) return; if (isBlack(dev)) restore(dev); else setLevel(dev, 100, "manual"); }
// the helper already took the veil away on a click: only bring back a dimming that was there before the black
function onClick(dev) {
  lv.set(dev, 0); by.delete(dev); touched.set(dev, Date.now());
  const b = before.get(dev) || 0; before.delete(dev);
  if (b > 0) setLevel(dev, b); else { lastActive.set(dev, Date.now()); ensureTimers(); renderAll(); }
}

async function onFocus() {   // black out every screen but the one with the mouse
  await refresh();
  if (screens.length < 2) return;
  const active = cursorDev || screens.find((s) => s.primary)?.device || screens[0].device;
  const others = screens.filter((s) => s.device !== active).map((s) => s.device);
  if (isBlack(active)) restore(active);
  if (others.every(isBlack)) others.forEach(restore);
  else others.filter((d) => !isBlack(d)).forEach((d) => setLevel(d, 100, "manual"));
}
function onAll() {
  if (!screens.length) return;
  const devs = screens.map((s) => s.device);
  if (devs.every(isBlack)) devs.forEach(restore);
  else devs.filter((d) => !isBlack(d)).forEach((d) => setLevel(d, 100, "manual"));
}
function restoreAll() { for (const dev of [...lv.keys()]) if (level(dev) > 0) { lv.set(dev, 0); by.delete(dev); before.delete(dev); touched.set(dev, Date.now()); } call({ cmd: "clear" }, 5000); ensureTimers(); renderAll(); }
function identify() { call({ cmd: "ident", ms: 1500, labels: Object.fromEntries(screens.map((s, i) => [s.device, String(i + 1)])) }, 5000); }
function setAuto(min) {
  S.autoMin = min; if (min > 0) S.lastAuto = min;
  const now = Date.now(); for (const s of screens) lastActive.set(s.device, now);   // count from now
  save(); ensureTimers(); renderAll();
}

// ----- auto: every few seconds look where the mouse and the focus are, and what changed on each screen -----
let tickTimer = null, watchTimer = null, ticking = false, tickN = 0;
function ensureTimers() {
  const auto = S.autoMin > 0 || [...by.values()].includes("auto");
  if (auto && !tickTimer) tickTimer = setInterval(tick, TICK_MS);
  else if (!auto && tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  // a black screen with a stuck helper would stay black: ask for a sign of life now and then
  if (anyDark() && !watchTimer) watchTimer = setInterval(() => { if (helper) call({ cmd: "ping" }, 8000); }, 15000);
  else if (!anyDark() && watchTimer) { clearInterval(watchTimer); watchTimer = null; }
}
async function tick() {
  if (ticking || !helper) return;
  ticking = true;
  try {
    const r = await refresh(++tickN % 3 === 1);   // a thumbnail every third time
    if (!r) return;
    const now = Date.now();
    for (const s of screens) {
      const dev = s.device, here = cursorDev === dev || fgDev === dev;
      if (isBlack(dev)) {
        if (by.get(dev) === "auto" && here) restore(dev);   // the mouse or the focus came back
        continue;
      }
      if (here || (s.changed != null && s.changed >= ACTIVITY_CELLS)) lastActive.set(dev, now);
      else if (S.autoMin > 0 && now - (lastActive.get(dev) ?? now) >= S.autoMin * AUTO_MS) setLevel(dev, 100, "auto");
    }
  } finally { ticking = false; }
}

// ----- drawing (keys 144x144, touchbar 750 units = 4 zones of 180 + gaps of 10) -----
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const BG = "#1b1e25", BLUE = "#2b6cff", MUTED = "#9aa3b2", GREEN = "#3ddc84";
function lines(text, max) {   // cut at spaces so that a hint fits a key
  const out = []; let cur = "";
  for (const w of String(text).split(" ")) { if (cur && (cur + " " + w).length > max) { out.push(cur); cur = w; } else cur = cur ? cur + " " + w : w; }
  if (cur) out.push(cur);
  return out;
}
const tx = (x, y, size, fill, s, weight = 400) => `<text x="${x}" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(s)}</text>`;
const hint = (text, y = 60) => lines(text, 12).map((l, i) => tx(72, y + i * 22, 17, MUTED, l)).join("");
const blank = () => `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" rx="26" fill="#000"/></svg>`;
const shade = (lvl) => {   // screen colour from its level: blue when bright, dark when dimmed
  const k = 1 - Math.min(lvl, 100) / 100, c = (a, b) => Math.round(a + (b - a) * k);
  return `rgb(${c(40, 43)},${c(44, 108)},${c(58, 255)})`;
};
const monitor = (x, y, w, h, fill, stroke, sw = 4) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/><rect x="${x + w / 2 - 14}" y="${y + h + 3}" width="28" height="5" rx="2.5" fill="${stroke}"/>`;
const tile = (inner, bg = BG, stroke = "") => `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" rx="26" fill="${bg}"${stroke ? ` stroke="${stroke}" stroke-width="3"` : ""}/>${inner}</svg>`;

function screenKey(i) {
  const s = screens[i];
  if (!helperUp) return i === 0 ? tile(hint(T.looking, 70)) : blank();
  if (!s) return i < 4 ? tile(monitor(34, 28, 76, 52, "none", "#363b47", 3) + tx(72, 124, 20, "#454c5b", "–")) : blank();
  const lvl = level(s.device), black = lvl >= 100, here = cursorDev === s.device;
  const dot = here ? `<circle cx="122" cy="22" r="8" fill="${GREEN}"/>` : "";
  if (black) {
    const label = by.get(s.device) === "auto" ? `${T.off} · ${T.auto}` : T.off;
    return tile(monitor(34, 22, 76, 56, "none", "#5b6272", 3) + tx(72, 62, 36, "#6b7280", i + 1, 700) + tx(72, 120, 20, MUTED, label, 600) + dot, "#000", "#2a2e38");
  }
  const label = lvl > 0 ? `${100 - lvl}%` : T.on;
  return tile(monitor(34, 22, 76, 56, shade(lvl), "#8fb0ff", 3) + tx(72, 62, 36, "#fff", i + 1, 700) + tx(72, 120, 20, lvl > 0 ? "#cfd8ea" : MUTED, label, 600) + dot);
}
function focusKey() {
  if (!helperUp) return blank();
  if (screens.length < 2) return tile(hint(T.needTwo, 70));
  const active = cursorDev || screens.find((s) => s.primary)?.device;
  const on = screens.every((s) => s.device === active || isBlack(s.device));
  const parts = [[14, "#2a2e38"], [54, on ? BLUE : "#5b86e8"], [94, "#2a2e38"]]
    .map(([x, c]) => `<rect x="${x}" y="30" width="36" height="46" rx="6" fill="${c}"/>`).join("");
  return tile(parts + tx(72, 120, 22, on ? "#fff" : MUTED, T.focus, 700), on ? "#12306b" : BG, on ? BLUE : "");
}
function allKey() {
  if (!helperUp) return blank();
  const on = screens.length > 0 && screens.every((s) => isBlack(s.device));
  const parts = [14, 54, 94].map((x) => `<rect x="${x}" y="30" width="36" height="46" rx="6" fill="${on ? "#000" : "#2a2e38"}" stroke="#5b6272" stroke-width="3"/>`).join("");
  return tile(parts + tx(72, 120, 22, on ? "#fff" : MUTED, on ? T.off : T.all, 700), on ? "#000" : BG, on ? "#2a2e38" : "");
}
function autoKey() {
  const on = S.autoMin > 0;
  const clock = `<circle cx="72" cy="52" r="30" fill="none" stroke="${on ? "#8fb0ff" : "#5b6272"}" stroke-width="5"/><line x1="72" y1="52" x2="72" y2="34" stroke="${on ? "#fff" : MUTED}" stroke-width="5" stroke-linecap="round"/><line x1="72" y1="52" x2="86" y2="60" stroke="${on ? "#fff" : MUTED}" stroke-width="5" stroke-linecap="round"/>`;
  return tile(clock + tx(72, 120, 22, on ? "#fff" : MUTED, on ? `${S.autoMin} ${T.min}` : `${T.auto} ${T.autoOff}`, 700), on ? "#12306b" : BG, on ? BLUE : "");
}
function keySvg(slot) {
  const si = SCREEN_SLOTS.indexOf(slot);
  if (si >= 0) return screenKey(si);
  if (slot === SLOT_FOCUS) return focusKey();
  if (slot === SLOT_ALL) return allKey();
  if (slot === SLOT_AUTO) return autoKey();
  return blank();
}

// the touchbar is 750 x 60 units (rendered 1000 x 80 px); zone 1 above knob 1, zone 2 above knob 2, the map above knobs 3-4
function stripSvg() {
  const dev = selDev(), lvl = dev ? level(dev) : 0;
  const bright = 100 - lvl, w1 = Math.round(160 * bright / 100);
  const zone1 = `<rect x="0" y="0" width="180" height="60" rx="10" fill="${BG}"/>
    <rect x="10" y="51" width="160" height="5" rx="2.5" fill="#2a2e38"/>${w1 ? `<rect x="10" y="51" width="${w1}" height="5" rx="2.5" fill="${BLUE}"/>` : ""}
    ${tx(90, 17, 13, MUTED, dev ? `${T.screen} ${selIdx + 1}` : T.none)}
    ${tx(90, 41, 25, lvl >= 100 ? MUTED : "#fff", dev ? (lvl >= 100 ? T.off : `${bright}%`) : "–", 700)}`;
  const on = S.autoMin > 0;
  const zone2 = `<rect x="190" y="0" width="180" height="60" rx="10" fill="${on ? "#12306b" : BG}"/>
    ${tx(280, 17, 13, MUTED, T.auto)}${tx(280, 43, 25, on ? "#fff" : MUTED, on ? `${S.autoMin} ${T.min}` : T.autoOff, 700)}`;
  // map of the screens, at their real places
  let map = `<rect x="380" y="0" width="370" height="60" rx="10" fill="${BG}"/>`;
  if (!screens.length) map += tx(565, 36, 17, MUTED, T.looking);
  else {
    const x0 = Math.min(...screens.map((s) => s.x)), y0 = Math.min(...screens.map((s) => s.y));
    const bw = Math.max(...screens.map((s) => s.x + s.w)) - x0, bh = Math.max(...screens.map((s) => s.y + s.h)) - y0;
    const k = Math.min(340 / bw, 46 / bh), ox = 565 - bw * k / 2, oy = 30 - bh * k / 2;
    screens.forEach((s, i) => {
      const x = ox + (s.x - x0) * k + 1.5, y = oy + (s.y - y0) * k + 1.5, w = Math.max(6, s.w * k - 3), h = Math.max(6, s.h * k - 3);
      const l = level(s.device), black = l >= 100, picked = i === Math.min(selIdx, screens.length - 1);
      map += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="4" fill="${black ? "#000" : shade(l)}" stroke="${picked ? "#fff" : black ? "#5b6272" : "#4a5160"}" stroke-width="${picked ? 2.5 : 1}"/>`;
      if (cursorDev === s.device && w > 24) map += `<circle cx="${(x + w - 7).toFixed(1)}" cy="${(y + 7).toFixed(1)}" r="3.5" fill="${GREEN}"/>`;
      map += tx((x + w / 2).toFixed(1), (y + h / 2 + Math.min(w, h) * 0.18).toFixed(1), Math.max(10, Math.min(22, Math.min(w, h) * 0.5)), black ? "#6b7280" : "#fff", i + 1, 700);
    });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="80" viewBox="0 0 750 60" preserveAspectRatio="none">${zone1}${zone2}${map}</svg>`;
}

// ----- StreamDock -----
const contexts = new Map();   // context -> { kind, col, row }
const lastSent = new Map();
const sd = new WebSocket(`ws://127.0.0.1:${PORT}`);
function send(o) { if (sd.readyState === WebSocket.OPEN) sd.send(JSON.stringify(o)); }
function setImage(context, svg) {
  if (lastSent.get(context) === svg) return;   // nothing changed: send nothing
  lastSent.set(context, svg);
  let url = null;
  try { const png = toPng(svg); if (png) url = pngUrl(png); } catch (e) { log("render", e.message); }
  send({ event: "setImage", context, payload: { target: 0, image: url || svgUrl(svg) } });
}
// key slot 0-9 from the position (AKP05: row 2 = top row), else reading order
function slotOf(id) {
  const c = contexts.get(id);
  if (c && c.col >= 0 && c.row >= 1) return Math.min(4, c.col) + (c.row === 2 ? 0 : 5);
  const keys = [...contexts.entries()].filter(([, x]) => x.kind === "key");
  keys.sort(([, a], [, b]) => (b.row ?? 0) - (a.row ?? 0) || (a.col ?? 0) - (b.col ?? 0));
  return Math.max(0, keys.findIndex(([k]) => k === id));
}
function renderAll() {
  for (const [id, c] of contexts) {
    if (c.kind === "key") setImage(id, keySvg(slotOf(id)));
    else if (c.kind === "strip") setImage(id, stripSvg());
    // knobs have no screen on the AKP05: their feedback is on the touchbar
  }
}

// ----- controls -----
function onRotate(c, ticks) {
  if (!ticks) return;
  const step = Math.sign(ticks) * Math.min(Math.abs(ticks), 3);   // ticks can be more than 1: keep it calm
  const col = c.col ?? 0;
  if (col === 0) {   // brightness of the picked screen: turn right = brighter. 100 % darker is the black, by the press
    const dev = selDev(); if (!dev) return;
    const cur = level(dev), next = Math.max(0, Math.min(cur >= 100 ? 100 : 95, cur - step * 5));
    if (next !== cur) setLevel(dev, next);
  } else if (col === 1) {   // auto delay
    const i = Math.max(0, AUTO_STEPS.indexOf(S.autoMin)), j = Math.max(0, Math.min(AUTO_STEPS.length - 1, i + Math.sign(step)));
    if (j !== i) setAuto(AUTO_STEPS[j]);
  } else if (col === 2 && screens.length) {   // pick a screen
    selIdx = (Math.min(selIdx, screens.length - 1) + Math.sign(step) + screens.length) % screens.length;
    renderAll();
  }
}
function onPress(id, c) {
  if (c.kind === "knob") {
    const col = c.col ?? 0;
    if (col === 0) toggle(selDev());
    else if (col === 1) setAuto(S.autoMin > 0 ? 0 : S.lastAuto);
    else if (col === 2) identify();
  } else if (c.kind === "strip") toggle(selDev());
  else if (c.kind === "key") {
    const slot = slotOf(id), si = SCREEN_SLOTS.indexOf(slot);
    if (si >= 0) { if (screens[si]) { selIdx = si; toggle(screens[si].device); } }
    else if (slot === SLOT_FOCUS) onFocus();
    else if (slot === SLOT_ALL) onAll();
    else if (slot === SLOT_AUTO) setAuto(S.autoMin > 0 ? 0 : S.lastAuto);
  }
}
// keyUp + touchTap (or dialDown + dialUp) can both arrive for one press: keep one
const lastPress = new Map();
function pressOnce(id, c) { const n = Date.now(); if (n - (lastPress.get(id) || 0) < 120) return; lastPress.set(id, n); onPress(id, c); }

// ----- settings page (pi.html) -----
function onPi(context, p) {
  if (p.cmd === "auto" && AUTO_STEPS.includes(Number(p.min))) setAuto(Number(p.min));
  else if (p.cmd === "identify") identify();
  else if (p.cmd === "restore") restoreAll();
  send({ event: "sendToPropertyInspector", context, payload: { autoMin: S.autoMin, screens: screens.length, helperUp, dark: anyDark(), lang: LANG } });
}
let lastPi = "";

sd.on("open", () => {
  send({ event: REGISTER_EVENT, uuid: PLUGIN_UUID }); log("registered, lang", LANG, Resvg ? "png" : "svg");
  if (S.autoMin > 0) { startHelper(); refresh(); ensureTimers(); }   // auto works even when no scene shows the plugin
});
sd.on("message", (buf) => {
  let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
  if (!msg?.event) return;
  const id = msg.context, c = contexts.get(id);
  switch (msg.event) {
    case "willAppear": {
      const co = msg.payload?.coordinates || {};
      contexts.set(id, { kind: String(msg.action || "").split(".").pop(), col: co.column, row: co.row });
      send({ event: "setTitle", context: id, payload: { title: "", target: 0 } });
      lastSent.delete(id);
      renderAll();
      if (!helper) startHelper();
      if (!helperUp) refresh();
      ensureTimers();
      break;
    }
    case "willDisappear":
      contexts.delete(id); lastSent.delete(id);
      if (!contexts.size) setTimeout(stopIfIdle, 15000);   // a scene change is not a reason to restart PowerShell
      break;
    case "dialRotate": if (c) onRotate(c, Number(msg.payload?.ticks) || 0); break;
    case "dialDown":
      if (c?.kind === "knob" && hop.isHubKnob(c.col)) { hop.open("oled-saver"); break; }
      if (c) pressOnce(id, c);
      break;
    case "keyUp": case "touchTap": if (c) pressOnce(id, c); break;
    case "propertyInspectorDidAppear": onPi(id, { cmd: "state" }); break;
    case "sendToPlugin": {
      // the settings page sends to two addresses (StreamDock sometimes drops one): keep the first copy
      const p = msg.payload || {}, target = contexts.has(id) ? id : p.ctx;
      if (!contexts.has(target)) break;
      const key = `${p.sid}:${p.n}`;
      if (p.sid && key === lastPi) break;
      lastPi = key;
      onPi(target, p);
      break;
    }
  }
});
sd.on("close", () => { wantHelper = false; try { helper?.stdin.end(); helper?.kill(); } catch {} process.exit(0); });
sd.on("error", (e) => log("ws error", e.message));
process.on("uncaughtException", (e) => log("uncaught", e.stack || e.message));
