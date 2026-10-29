// Builds the ready-to-use plugin in dist/ (icons, translations, dependencies, notices) and the store package.
// Usage:  node scripts/build.cjs   (node_modules: ws, @resvg/resvg-js)
//   dist/com.cherki.oledsaver.sdPlugin/       the plugin (install.cjs copies it into StreamDock)
//   dist/com.cherki.oledsaver.sdPlugin.zip    file to upload to the Space Station store
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { renderPng, vendor } = require("./common.cjs");

const ROOT = path.join(__dirname, "..");
const NAME = "com.cherki.oledsaver.sdPlugin";
const SRC = path.join(ROOT, NAME);
const DIST = path.join(ROOT, "dist");
const OUT = path.join(DIST, NAME);
const ZIP = path.join(DIST, `${NAME}.zip`);
const MODULES = path.join(ROOT, "node_modules");

// icons, drawn here so they always match the plugin (replace with the plugin's own drawings)
const tile = (s, inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 144 144"><rect width="144" height="144" rx="26" fill="#1b1e25"/>${inner}</svg>`;
// a monitor: black screen (an OLED at rest), light outline, small stand
const MON = (x, y, w, h, fill, stroke, sw = 6) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/><rect x="${x + w / 2 - 16}" y="${y + h + 5}" width="32" height="6" rx="3" fill="${stroke}"/>`;
const MARK = MON(18, 30, 108, 70, "#000", "#8fb0ff");
const ICONS = {
  "plugin.png": tile(144, MARK), "category.png": tile(56, MARK),
  "key.png": tile(144, MON(30, 36, 84, 56, "#000", "#8fb0ff")),
  "strip.png": tile(144, MON(8, 52, 40, 26, "#000", "#8fb0ff", 4) + MON(52, 52, 40, 26, "#2b6cff", "#8fb0ff", 4) + MON(96, 52, 40, 26, "#000", "#8fb0ff", 4)),
  "knob.png": tile(144, `<circle cx="72" cy="72" r="42" fill="#2a2a2d" stroke="#2b6cff" stroke-width="8"/><line x1="72" y1="36" x2="72" y2="56" stroke="#2b6cff" stroke-width="8" stroke-linecap="round"/>`),
};
const DESC_FR = "Rendez noir ou atténuez n'importe quel écran, une touche par écran, pour protéger les dalles OLED du marquage.";
const DESC_ZH = "让任意屏幕变黑或调暗，每个屏幕一个按键，保护 OLED 显示器避免烧屏。";
const LANGS = {
  en: { Name: "OLED Saver", Category: "OLED Saver", Description: "Black out or dim any screen, one key per monitor, to protect OLED panels from burn-in.",
    key: ["OLED Saver – Key", "Put it on the 10 keys: screens 1-4, Focus, All and Auto, by place"],
    strip: ["OLED Saver – Touchbar", "The whole touchbar: brightness, auto delay and a map of your screens. Tap = black out the picked screen"],
    knob: ["OLED Saver – Knob", "Put it on the 4 knobs: brightness, auto delay, pick a screen (knob 4 = Scene Zapper)"] },
  fr: { Name: "OLED Saver", Category: "OLED Saver", Description: DESC_FR,
    key: ["OLED Saver – Touche", "À poser sur les 10 touches : écrans 1-4, Focus, Tous et Auto, selon la place"],
    strip: ["OLED Saver – Touchbar", "Toute la touchbar : luminosité, délai auto et plan de vos écrans. Toucher = noir sur l'écran choisi"],
    knob: ["OLED Saver – Molette", "À poser sur les 4 molettes : luminosité, délai auto, choix de l'écran (molette 4 = Scene Zapper)"] },
  zh_CN: { Name: "OLED Saver", Category: "OLED Saver", Description: DESC_ZH,
    key: ["OLED Saver – 按键", "放在 10 个按键上：屏幕 1-4、专注、全部和自动，按位置自动分配"],
    strip: ["OLED Saver – 触控条", "整个触控条：亮度、自动延时和屏幕示意图。点按 = 所选屏幕黑屏"],
    knob: ["OLED Saver – 旋钮", "放在 4 个旋钮上：亮度、自动延时、选择屏幕（旋钮 4 = Scene Zapper）"] },
};
function i18nJson(t) {
  const out = { Name: t.Name, Category: t.Category, Description: t.Description, Localization: {} };
  for (const k of ["key", "strip", "knob"]) out[`com.cherki.oledsaver.${k}`] = { Name: t[k][0], Tooltip: t[k][1] };
  return JSON.stringify(out, null, 2);
}

function notices() {
  let txt = "OLED Saver\n\nOPEN-SOURCE PACKAGES (bundled, unmodified)\n\n";
  for (const [p, lic] of [["ws", "MIT"], ["@resvg/resvg-js", "MPL-2.0"]]) {
    const dir = path.join(MODULES, p);
    const version = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version;
    const licFile = fs.readdirSync(dir).find((f) => /^licen[sc]e/i.test(f));
    txt += `==== ${p} ${version} (${lic}) ====\n`;
    txt += lic === "MPL-2.0" ? "Source code: https://github.com/yisibl/resvg-js\n" : "";
    txt += (licFile ? fs.readFileSync(path.join(dir, licFile), "utf8") : `License: ${lic}`) + "\n\n";
  }
  return txt;
}

function build() {
  // empty dist/ instead of deleting it: Windows refuses (EPERM) while a terminal sits inside it
  fs.mkdirSync(DIST, { recursive: true });
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.rmSync(ZIP, { force: true });
  fs.cpSync(SRC, OUT, { recursive: true, filter: (p) => !/\.log$/.test(p) && !p.includes(`${path.sep}node_modules`) });
  fs.mkdirSync(path.join(OUT, "images"), { recursive: true });
  for (const [file, s] of Object.entries(ICONS)) fs.writeFileSync(path.join(OUT, "images", file), renderPng(s));
  for (const [lang, t] of Object.entries(LANGS)) fs.writeFileSync(path.join(OUT, `${lang}.json`), i18nJson(t));
  fs.writeFileSync(path.join(OUT, "THIRD_PARTY_NOTICES.txt"), notices());
  vendor(OUT, ["ws", "@resvg/resvg-js", "@resvg/resvg-js-win32-x64-msvc"]);
  return OUT;
}

function zip() {
  execFileSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(__dirname, "zip.ps1"),
    "-Source", OUT, "-Destination", ZIP], { stdio: "inherit" });
  return ZIP;
}

module.exports = { build, zip, OUT, ZIP, NAME };
if (require.main === module) {
  build();
  zip();
  console.log(`✅ Built ${OUT}\n✅ Store package ${ZIP} (${Math.round(fs.statSync(ZIP).size / 1024)} KB)`);
}
