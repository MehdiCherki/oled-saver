// Test of the REAL helper.ps1 on this PC.
//   node scripts/test-real-helper.cjs           read-only: compiles, lists the screens, takes two thumbnails, pings
//   node scripts/test-real-helper.cjs --veil    also drives the screens for a few seconds: the primary screen is dimmed
//                                               to 30 % for 1.5 s, then the screen numbers show for 1.2 s. Run it when you
//                                               are ready to see your screen change; nothing stays on afterwards.
const { spawn } = require("child_process");
const path = require("path");
const helper = path.join(__dirname, "..", "com.cherki.oledsaver.sdPlugin", "plugin", "helper.ps1");
const VEIL = process.argv.includes("--veil");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, detail = "") => { if (!ok) fails++; console.log(ok ? "  ok  " : "  FAIL", name, detail); };

const p = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", helper], { windowsHide: true });
let buf = "", n = 0;
const waiting = new Map(), pushed = [];
p.stdout.setEncoding("utf8");
p.stdout.on("data", (d) => {
  buf += d; let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    const m = JSON.parse(line);
    if (m.n && waiting.has(m.n)) { waiting.get(m.n)(m); waiting.delete(m.n); } else pushed.push(m);
  }
});
p.stderr.on("data", (d) => console.log("  STDERR", String(d).slice(0, 600)));
const call = (cmd) => new Promise((resolve, reject) => {
  const id = ++n; waiting.set(id, resolve);
  p.stdin.write(JSON.stringify({ ...cmd, n: id }) + "\n");
  setTimeout(() => { if (waiting.delete(id)) reject(new Error(`no answer to ${cmd.cmd}`)); }, 20000);
});

(async () => {
  const t0 = Date.now();
  check("ping answered (helper compiled)", (await call({ cmd: "ping" })).t === "pong", `${Date.now() - t0} ms`);
  const l1 = await call({ cmd: "list" });
  const sc = l1.screens;
  check("at least one screen", sc.length >= 1, sc.map((s) => `${s.w}x${s.h}@${s.x},${s.y}${s.primary ? "*" : ""}`).join("  "));
  check("screens sorted left to right", sc.every((s, i) => i === 0 || sc[i - 1].x <= s.x));
  check("cursor and focus are on a known screen", sc.some((s) => s.device === l1.cursor) && (l1.fg === "" || sc.some((s) => s.device === l1.fg)), `cursor ${l1.cursor.slice(-8)} focus ${l1.fg.slice(-8)}`);
  check("every screen reports level 0", sc.every((s) => s.level === 0));
  await call({ cmd: "list", sample: true });
  await sleep(300);
  const l3 = await call({ cmd: "list", sample: true });
  check("second thumbnail gives a count of changed cells", l3.screens.every((s) => typeof s.changed === "number"), l3.screens.map((s) => s.changed).join(","));
  check("an unknown screen is refused", (await call({ cmd: "level", device: "\\\\.\\NOPE", level: 100 })).ok === false);

  if (VEIL) {
    const prim = sc.find((s) => s.primary) || sc[0];
    console.log("  ... the primary screen dims to 30 % for 1.5 s");
    check("dim order accepted", (await call({ cmd: "level", device: prim.device, level: 30 })).ok === true);
    const d = await call({ cmd: "list" });
    check("the list reports the veil", d.screens.find((s) => s.device === prim.device).level === 30);
    await sleep(1500);
    await call({ cmd: "level", device: prim.device, level: 0 });
    check("veil removed", (await call({ cmd: "list" })).screens.every((s) => s.level === 0));
    console.log("  ... the screen numbers show for 1.2 s");
    await call({ cmd: "ident", ms: 1200, labels: Object.fromEntries(sc.map((s, i) => [s.device, String(i + 1)])) });
    await sleep(1500);
  }
  const t1 = Date.now();
  p.stdin.end();
  await new Promise((r) => p.on("exit", r));
  check("the helper leaves when stdin closes", Date.now() - t1 < 3000, `${Date.now() - t1} ms`);
  console.log(fails ? `${fails} FAILED` : "ALL OK");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("ABORT", e.message); try { p.kill(); } catch {} process.exit(1); });
