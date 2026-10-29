// scene-hop.js - opens the Sélecteur de chaînes ("Chaînes") when knob 4 is pressed.
// Copied into each plugin's plugin/ folder by shared/sync.cjs: edit only the copy in D:\30 Dev\31 Projets\AJAZZ\AJAZZ SDK\plugins\_shared.
//
// Opt-in: nothing happens unless the Sélecteur de chaînes is installed, has its "Chaînes" scene and is running
// (%APPDATA%\cherki-hub\hub.json with a live pid). Without it, the plugin keeps its own knob 4 press.
//
// In a plugin:   const hop = require("./scene-hop");
//                if (isKnob && hop.isHubKnob(column)) { hop.open("<plugin name>"); return; }   // in the knob press
// CHANNELS_HUB replaces the hub folder (tests).
const fs = require("fs");
const path = require("path");
const http = require("http");

const HUB_FILE = path.join(process.env.CHANNELS_HUB || path.join(process.env.APPDATA || "", "cherki-hub"), "hub.json");
let cache = { at: 0, hub: null };

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}
// The running selector, or null (checked at most every 2 s: a knob press costs nothing)
function hub() {
  const now = Date.now();
  if (now - cache.at < 2000) return cache.hub;
  cache = { at: now, hub: null };
  try {
    const h = JSON.parse(fs.readFileSync(HUB_FILE, "utf8"));
    if (h.enabled && h.port > 0 && alive(h.pid)) cache.hub = h;
  } catch {}
  return cache.hub;
}

// Knob 4 = the rightmost knob, column 3 of the knob row
function isHubKnob(column) { return Number(column) === 3 && !!hub(); }

let last = 0;
function open(from, ticks = 0) {
  const h = hub();
  if (!h) return false;
  const now = Date.now();
  if (now - last < 400) return true;   // keyUp / dialDown doubles: one request
  last = now;
  const req = http.request({ host: "127.0.0.1", port: h.port, method: "POST", timeout: 1500,
    path: `/open?from=${encodeURIComponent(String(from || ""))}&ticks=${Math.round(Number(ticks) || 0)}` });
  req.on("timeout", () => req.destroy());
  req.on("error", () => { cache.at = 0; });   // the selector stopped: look again at the next press
  req.end();
  return true;
}

module.exports = { isHubKnob, open, hub, HUB_FILE };
