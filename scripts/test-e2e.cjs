// End-to-end test of OLED Saver with fakes only: a fake StreamDock (AKP05 layout: 10 keys, 4 knobs, touchbar) and a
// fake helper with three screens (scripts/fake-helper.cjs). Nothing real is driven: no veil on the real screens.
//   node scripts/test-e2e.cjs        -> pictures in %TEMP%\oledsaver-test\shots
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const ROOT = path.join(__dirname, "..");
const WebSocket = require(path.join(ROOT, "node_modules", "ws"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DIR = path.join(os.tmpdir(), "oledsaver-test"), SHOTS = path.join(DIR, "shots");
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });
const ORDERS = path.join(DIR, "orders.log"), CTL = path.join(DIR, "ctl.json");
const D = (n) => `\\\\.\\DISPLAY${n}`;

let sock = null, fails = 0, p = null;
const images = new Map(), toPI = [];
const check = (name, ok, detail = "") => { if (!ok) fails++; console.log(ok ? "  ok  " : "  FAIL", name, detail); };
const shot = (ctx, name) => { const u = images.get(ctx); if (u?.startsWith("data:image/png")) fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(u.split(",")[1], "base64")); };
const send = (o) => sock.send(JSON.stringify(o));
const appear = (context, kind, col, row) => send({ event: "willAppear", action: `com.cherki.oledsaver.${kind}`, context, payload: { coordinates: { column: col, row }, settings: {} } });
const ev = (event, context, payload = {}) => send({ event, context, payload });
const keys = Array.from({ length: 10 }, (_, i) => `key${i}`);
const ctl = (o) => fs.writeFileSync(CTL, JSON.stringify(o));
const orders = () => { try { return fs.readFileSync(ORDERS, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const levels = (from = 0) => orders().slice(from).filter((o) => o.cmd === "level").map((o) => `${o.device.slice(-1)}=${o.level}`).join(",");
const mark = () => orders().length;
const press = async (id) => { ev("keyUp", id); ev("touchTap", id); await sleep(250); };   // StreamDock sends both for one press
const lastLevel = (n) => orders().filter((o) => o.cmd === "level" && o.device === D(n)).pop()?.level;
const FAST = { OLEDSAVER_AUTO_MS: "1000", OLEDSAVER_TICK_MS: "100", OLEDSAVER_CALL_MS: "500" };   // "1 minute" = 1 s

const wss = new WebSocket.Server({ port: 0 }, () => {
  ctl({ cursor: D(2) });
  p = spawn(process.execPath, [path.join(ROOT, "com.cherki.oledsaver.sdPlugin", "plugin", "index.js"), "-port", String(wss.address().port), "-pluginUUID", "T", "-registerEvent", "registerPlugin"],
    { stdio: "inherit", env: { ...process.env, ...FAST, NODE_PATH: path.join(ROOT, "node_modules"), OLEDSAVER_STATE: path.join(DIR, "state.json"), OLEDSAVER_LANG: "fr",
      OLEDSAVER_HELPER: path.join(__dirname, "fake-helper.cjs"), OLEDSAVER_FAKE_DIR: DIR, CHANNELS_HUB: path.join(DIR, "no-hub") } });
  run().catch((e) => { fails++; console.log("ABORT", e.stack); }).finally(() => {
    console.log("images:", SHOTS);
    console.log(fails ? `${fails} FAILED` : "ALL OK");
    p.kill(); wss.close(); setTimeout(() => process.exit(fails ? 1 : 0), 300);
  });
});
wss.on("connection", (ws) => {
  sock = ws;
  ws.on("message", (b) => {
    const m = JSON.parse(b.toString());
    if (m.event === "setImage") images.set(m.context, m.payload.image);
    if (m.event === "sendToPropertyInspector") toPI.push(m.payload);
  });
});

async function run() {
  while (!sock) await sleep(50);
  keys.forEach((id, i) => appear(id, "key", i % 5, i < 5 ? 2 : 1));
  appear("strip", "strip", -1, -1);
  for (let i = 0; i < 4; i++) appear(`knob${i}`, "knob", i, 0);
  await sleep(1500);

  console.log("1. first images, three screens found");
  check("the 10 keys and the touchbar are drawn as PNG", [...keys, "strip"].every((id) => images.get(id)?.startsWith("data:image/png")));
  keys.forEach((id, i) => shot(id, `1-key${i}`)); shot("strip", "1-strip");
  check("screen keys 0-2 differ from the empty key 3", images.get("key0") !== images.get("key3") && images.get("key1") !== images.get("key3"));
  check("no order sent just by looking", levels() === "");

  console.log("2. a key black-outs its screen, one press counts once");
  let m = mark(), before = images.get("key0");
  await press("key0");
  check("screen 1 -> black", levels(m) === "1=100", levels(m));
  check("key 1 redrawn", images.get("key0") !== before); shot("key0", "2-key0-black");
  check("touchbar redrawn", images.get("strip")?.length > 0); shot("strip", "2-strip");
  m = mark(); await press("key0");
  check("second press brings it back", levels(m) === "1=0", levels(m));
  shot("key0", "2-key0-back");

  console.log("3. knob 1 = brightness of the picked screen, knob 3 picks the screen");
  m = mark(); ev("dialRotate", "knob0", { ticks: -2 }); await sleep(250);
  check("2 ticks darker = brightness 90 % (level 10) on screen 1 (picked by the key press)", levels(m) === "1=10", levels(m));
  m = mark(); ev("dialRotate", "knob0", { ticks: 1 }); await sleep(250);
  check("1 tick brighter = level 5", levels(m) === "1=5", levels(m));
  m = mark(); ev("dialRotate", "knob2", { ticks: 1 }); await sleep(250);
  check("knob 3 picks screen 2: no order", levels(m) === "");
  ev("dialRotate", "knob0", { ticks: -1 }); await sleep(250);
  check("brightness now acts on screen 2", lastLevel(2) === 5, String(lastLevel(2))); shot("strip", "3-strip-screen2");
  ev("dialRotate", "knob0", { ticks: 5 }); await sleep(250);
  check("never brighter than 100 %", lastLevel(2) === 0, String(lastLevel(2)));
  ev("dialDown", "knob0"); ev("dialUp", "knob0"); await sleep(250);
  check("knob 1 press = black on screen 2", lastLevel(2) === 100, String(lastLevel(2)));
  ev("dialRotate", "knob0", { ticks: 1 }); await sleep(250);
  check("turn right from black = 95 (see-through, click-through)", lastLevel(2) === 95, String(lastLevel(2)));
  for (let i = 0; i < 9; i++) { ev("dialRotate", "knob0", { ticks: 3 }); await sleep(60); }
  await sleep(200);
  check("turning right brings it back to normal and stops there", lastLevel(2) === 0, String(lastLevel(2)));
  ev("sendToPlugin", "key0", { cmd: "restore", ctx: "key0", sid: "r", n: 1 }); await sleep(300);   // tidy up

  console.log("4. Focus keeps only the screen under the mouse");
  ctl({ cursor: D(2) }); m = mark();
  await press("key4");
  check("screens 1 and 3 black, screen 2 untouched", levels(m) === "1=100,3=100", levels(m)); shot("key4", "4-focus-on"); shot("strip", "4-strip-focus");
  m = mark(); await press("key4");
  check("second press brings them back", levels(m) === "1=0,3=0", levels(m));
  ctl({ cursor: D(3) }); m = mark(); await press("key4");
  check("mouse on screen 3: screens 1 and 2 black", levels(m) === "1=100,2=100", levels(m));
  m = mark(); await press("key4");

  console.log("5. All");
  m = mark(); await press("key5");
  check("all three black", levels(m) === "1=100,2=100,3=100", levels(m)); shot("key5", "5-all-on");
  m = mark(); await press("key5");
  check("all three back", levels(m) === "1=0,2=0,3=0", levels(m));

  console.log("6. a click on a black screen brings it back (the helper removes the veil)");
  await press("key2");
  check("screen 3 black", lastLevel(3) === 100);
  const img = images.get("key2");
  ctl({ cursor: D(3), click: D(3), clickSeq: 1 }); await sleep(400);
  check("key 3 redrawn as on", images.get("key2") !== img); shot("key2", "6-key2-clicked");
  m = mark(); await press("key2");
  check("a press after the click blacks it out again (the plugin follows the helper)", levels(m) === "3=100", levels(m));
  ctl({ cursor: D(2), click: D(3), clickSeq: 2 }); await sleep(300);

  console.log("7. Auto: idle screens go black, the one with the mouse or the focus stays, mouse return wakes");
  ctl({ cursor: D(2), fg: D(2) }); m = mark();
  ev("dialRotate", "knob1", { ticks: 1 }); await sleep(2200);   // 1 min = 1 s in this test
  check("auto 1 min saved", JSON.parse(fs.readFileSync(path.join(DIR, "state.json"), "utf8")).autoMin === 1);
  check("screens 1 and 3 went black on their own", levels(m).includes("1=100") && levels(m).includes("3=100") && !levels(m).includes("2="), levels(m)); shot("key0", "7-key0-auto"); shot("strip", "7-strip-auto");
  m = mark(); ctl({ cursor: D(1), fg: D(1) }); await sleep(500);
  check("mouse on screen 1 wakes it, screen 3 stays black", levels(m) === "1=0", levels(m));
  ctl({ cursor: D(2), fg: D(2), changed: { [D(1)]: 200 } }); m = mark(); await sleep(2200);
  check("a screen whose picture changes is not blacked out", !levels(m).includes("1=100"), levels(m));
  ctl({ cursor: D(2), fg: D(2), changed: { [D(1)]: 2 } }); await sleep(2300);
  check("a few changed cells (a clock) do not count as activity", lastLevel(1) === 100, String(lastLevel(1)));
  const autoOn = images.get("key6");
  ev("dialDown", "knob1"); await sleep(300);
  check("knob 2 press = auto off (Auto key redrawn)", images.get("key6") !== autoOn);
  m = mark(); await sleep(1500);
  check("auto off: nothing more is blacked out", levels(m) === "", levels(m));
  ev("dialDown", "knob1"); await sleep(300);
  check("knob 2 press again = auto back on", images.get("key6") === autoOn);
  ev("dialDown", "knob1"); await sleep(300);
  ev("sendToPlugin", "key0", { cmd: "restore", ctx: "key0", sid: "r2", n: 1 }); await sleep(300);

  console.log("8. identify, settings page, restore");
  m = mark(); ev("dialDown", "knob2"); ev("dialUp", "knob2"); await sleep(300);
  const id = orders().slice(m).find((o) => o.cmd === "ident");
  check("knob 3 press sends the numbers 1-3", id && id.labels[D(1)] === "1" && id.labels[D(3)] === "3", JSON.stringify(id));
  toPI.length = 0;
  const payload = { cmd: "auto", min: 5, ctx: "key0", sid: "s1", n: 1 };
  ev("sendToPlugin", "key0", payload); ev("sendToPlugin", "T", payload); await sleep(400);
  check("the settings page got one answer", toPI.length === 1, `${toPI.length} answers`);
  check("auto delay set to 5", toPI[0]?.autoMin === 5 && toPI[0]?.screens === 3, JSON.stringify(toPI[0]));
  check("the Auto key shows 5 min", images.get("key6") !== autoOn); shot("key6", "8-auto-5min");
  ev("sendToPlugin", "key0", { cmd: "auto", min: 0, ctx: "key0", sid: "s2", n: 1 }); await sleep(300);

  console.log("9. the helper dies: veils are forgotten, helper restarts");
  await press("key0");
  check("screen 1 black", lastLevel(1) === 100);
  const dark = images.get("key0");
  ctl({ die: true }); await sleep(500);
  check("key 1 redrawn without the black", images.get("key0") !== dark);
  ctl({ cursor: D(2) }); await sleep(3600);
  check("helper restarted", orders().filter((o) => o.started).length >= 2, `${orders().filter((o) => o.started).length} starts`);
  check("screens found again", images.get("key0") !== images.get("key3")); shot("key0", "9-after-restart");

  console.log("10. a stuck helper is restarted");
  ev("dialRotate", "knob1", { ticks: 1 }); await sleep(300);   // auto on = ticks
  const starts = orders().filter((o) => o.started).length;
  ctl({ cursor: D(2), hang: true }); await sleep(1800);
  ctl({ cursor: D(2) }); await sleep(3800);
  check("restarted after two unanswered orders", orders().filter((o) => o.started).length > starts, `${orders().filter((o) => o.started).length} starts`);
  ev("dialDown", "knob1"); await sleep(200);

}
