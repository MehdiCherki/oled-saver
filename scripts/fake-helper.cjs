// A fake helper.ps1 for the tests: three screens side by side, veils kept in memory, nothing real is touched.
//   OLEDSAVER_HELPER=<this file>   OLEDSAVER_FAKE_DIR=<folder>
// The test steers it through <folder>/ctl.json: { cursor, fg, changed: {device: cells}, click: device, clickSeq, die, hang }
// and reads what the plugin asked in <folder>/orders.log (one JSON line per "level" / "clear" / "ident" order).
const fs = require("fs");
const path = require("path");

const DIR = process.env.OLEDSAVER_FAKE_DIR || process.cwd();
const CTL = path.join(DIR, "ctl.json"), ORDERS = path.join(DIR, "orders.log");
const D = (n) => `\\\\.\\DISPLAY${n}`;
const screens = [
  { device: D(1), x: 0, y: 0, w: 1920, h: 1080, primary: false, level: 0 },
  { device: D(2), x: 1920, y: 0, w: 2560, h: 1440, primary: true, level: 0 },
  { device: D(3), x: 4480, y: 0, w: 1920, h: 1080, primary: false, level: 0 },
];
fs.appendFileSync(ORDERS, JSON.stringify({ started: true }) + "\n");
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");
const note = (o) => fs.appendFileSync(ORDERS, JSON.stringify(o) + "\n");
const ctl = () => { try { return JSON.parse(fs.readFileSync(CTL, "utf8")); } catch { return {}; } };

let seenClick = ctl().clickSeq || 0;
setInterval(() => {
  const c = ctl();
  if (c.die) process.exit(3);
  if ((c.clickSeq || 0) !== seenClick) {
    seenClick = c.clickSeq || 0;
    const s = screens.find((x) => x.device === c.click);
    if (s && s.level >= 100) { s.level = 0; out({ t: "click", device: s.device }); }   // the real helper takes the veil away on a click
  }
}, 40);

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  buf += d; let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    const m = JSON.parse(line), c = ctl();
    if (c.hang) continue;   // stuck: no answer
    switch (m.cmd) {
      case "ping": out({ t: "pong", n: m.n }); break;
      case "list": {
        const sample = !!m.sample;
        out({ t: "list", n: m.n, cursor: c.cursor || D(2), fg: c.fg || c.cursor || D(2),
          screens: screens.map((s) => ({ ...s, ...(sample && s.level < 100 && c.changed ? { changed: c.changed[s.device] || 0 } : {}) })) });
        break;
      }
      case "level": {
        const s = screens.find((x) => x.device === m.device);
        if (s) s.level = m.level;
        note({ cmd: "level", device: m.device, level: m.level });
        out({ t: "level", n: m.n, ok: !!s });
        break;
      }
      case "clear": screens.forEach((s) => { s.level = 0; }); note({ cmd: "clear" }); out({ t: "clear", n: m.n }); break;
      case "ident": note({ cmd: "ident", labels: m.labels }); out({ t: "ident", n: m.n }); break;
      default: out({ t: "error", n: m.n, err: `unknown ${m.cmd}` });
    }
  }
});
process.stdin.on("end", () => process.exit(0));
