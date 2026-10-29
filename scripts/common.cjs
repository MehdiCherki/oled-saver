// Shared helpers for the installers and scene scripts.
//
// StreamDock stores each scene as  %APPDATA%\HotSpot\StreamDock\profiles\<ID>.sdProfile\manifest.json
// Facts that are not in the SDK docs (verified on an AKP05E Pro, StreamDock 3.10.200):
//   - keypad keys are "col,row" with row 2 = TOP row and row 1 = BOTTOM row
//   - knobs are "0,0".."3,0" with Controller "Knob" (events dialRotate / dialDown)
//   - the touchbar is Actions.touchbar.Actions[], each widget sized by Settings.touchbarWidth,
//     750 units visible, 10-unit gaps (4 x 180 = one widget above each knob)

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const MODULES = path.join(__dirname, "..", "node_modules");
const STREAMDOCK = path.join(process.env.APPDATA || "", "HotSpot", "StreamDock");
const PROFILES = path.join(STREAMDOCK, "profiles");
const PLUGINS = path.join(STREAMDOCK, "plugins");

function isRunning(re) {
  try {
    return execSync("tasklist /FO CSV /NH", { encoding: "utf8" }).split(/\r?\n/).some((l) => re.test(l));
  } catch { return false; }
}
// The AJAZZ build's process is "Stream Dock AJAZZ.exe" (with spaces)
const streamDockRunning = () => isRunning(/^"stream ?dock[^"]*\.exe"/i);

function requireStreamDockClosed() {
  if (streamDockRunning()) {
    console.error("❌ StreamDock is running. Quit it (tray icon → Quit) and run this again.");
    console.error("   StreamDock est ouvert : quitte-le (icône près de l'horloge → Quitter) puis relance.");
    process.exit(1);
  }
}

function readProfile(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(PROFILES, dir, "manifest.json"), "utf8")); } catch { return null; }
}

// Finds the AKP05 to target: AKP05_SERIAL env var, else the most recently used AKP05 profile.
function findDevice() {
  const wanted = process.env.AKP05_SERIAL;
  let best = null;
  for (const dir of fs.existsSync(PROFILES) ? fs.readdirSync(PROFILES) : []) {
    const m = readProfile(dir);
    if (!m?.DeviceSerialNumber || !/AKP05/i.test(m.DeviceUUID || "")) continue;
    if (wanted && m.DeviceSerialNumber !== wanted) continue;
    const mtime = fs.statSync(path.join(PROFILES, dir, "manifest.json")).mtimeMs;
    if (!best || mtime > best.mtime) {
      best = { serial: m.DeviceSerialNumber, model: m.DeviceModel, uuid: m.DeviceUUID, version: m.Version || "1.0", mtime };
    }
  }
  if (!best) {
    console.error("❌ No AKP05 scene found. Plug the device in, open StreamDock once (Touchbar mode), quit it, and retry.");
    console.error("   Set AKP05_SERIAL=<serial> if you have several devices.");
    process.exit(1);
  }
  return best;
}

const ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";
const rnd = (n, abc = ALNUM) => Array.from({ length: n }, () => abc[Math.floor(Math.random() * abc.length)]).join("");
const actionId = () => `${rnd(8)}-${rnd(4)}-${rnd(4)}-${rnd(4)}-${rnd(12)}`;
const profileId = () => {
  const up = ALNUM.toUpperCase();
  return `${rnd(8, up)}-${rnd(4, up)}-${rnd(4, up)}-${rnd(4, up)}-${rnd(12, up)}.sdProfile`;
};

// One action entry as StreamDock writes it in a profile
function action(uuid, name, settings, controller = "") {
  return {
    ActionID: actionId(),
    Actions: [],
    Controller: controller,
    Name: name,
    Settings: settings,
    State: 0,
    States: [{ Image: "images/icon.png" }],
    UUID: uuid,
  };
}

// keypad slot 0-9 (0-4 = top row, 5-9 = bottom row) -> profile key "col,row"
const keyPos = (slot) => `${slot % 5},${slot < 5 ? 2 : 1}`;

// Writes a new scene. keys: { slot: action }, knobs: [action x4], touchbar: [widget actions]
function createScene(name, { keys = {}, knobs = [], touchbar = [] }) {
  requireStreamDockClosed();
  const existing = fs.readdirSync(PROFILES).find((d) => readProfile(d)?.Name === name);
  if (existing) {
    console.error(`❌ A scene named "${name}" already exists (${existing}). Delete or rename it first.`);
    process.exit(1);
  }
  const dev = findDevice();
  const id = profileId();
  const actions = {};
  knobs.forEach((a, i) => { if (a) actions[`${i},0`] = a; });
  for (const [slot, a] of Object.entries(keys)) actions[keyPos(Number(slot))] = a;
  actions.touchbar = {
    ActionID: "", Actions: touchbar, Controller: "", Name: "",
    Settings: { touchbarBackgroundImageName: 0, widgetCurrX: 0 }, State: 0, States: [], UUID: "touchbar",
  };
  const manifest = {
    Actions: actions,
    DeviceModel: dev.model,
    DeviceSerialNumber: dev.serial,
    DeviceUUID: dev.uuid,
    Name: name,
    Pages: { Current: id, Pages: [id] },
    Version: dev.version,
  };
  const dir = path.join(PROFILES, id);
  fs.mkdirSync(path.join(dir, "Images"), { recursive: true });
  fs.mkdirSync(path.join(dir, "profiles"), { recursive: true });
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 4));
  console.log(`✅ Scene "${name}" created for ${dev.uuid} (${dev.serial}): ${dir}`);
}

// Copies node_modules packages next to a plugin (StreamDock runs plain Node 20, no bundler)
function vendor(pluginDir, packages) {
  for (const pkg of packages) {
    const src = path.join(MODULES, pkg);
    if (!fs.existsSync(src)) {
      console.error(`❌ Missing dependency ${pkg}. Run  npm install  in the repository root first.`);
      process.exit(1);
    }
    const dst = path.join(pluginDir, "node_modules", pkg);
    fs.rmSync(dst, { recursive: true, force: true });
    fs.cpSync(src, dst, { recursive: true });
  }
}

function renderPng(svg) {
  const { Resvg } = require(path.join(MODULES, "@resvg", "resvg-js"));
  return new Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng();
}

// Builds icon + dependencies, then copies the plugin folder into StreamDock
function installPlugin(pluginDir, { iconSvg, packages = ["ws"] }) {
  requireStreamDockClosed();
  fs.mkdirSync(path.join(pluginDir, "images"), { recursive: true });
  fs.writeFileSync(path.join(pluginDir, "images", "icon.png"), renderPng(iconSvg));
  vendor(pluginDir, packages);
  const target = path.join(PLUGINS, path.basename(pluginDir));
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(pluginDir, target, { recursive: true, filter: (p) => !p.endsWith(".log") });
  console.log("✅ Installed:", target);
  return target;
}

module.exports = {
  MODULES, STREAMDOCK, PROFILES, PLUGINS,
  isRunning, streamDockRunning, requireStreamDockClosed, readProfile, findDevice,
  action, keyPos, createScene, vendor, renderPng, installPlugin,
};
