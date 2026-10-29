// OLED Saver - French / English / Simplified Chinese (English for other languages).
// The Windows display language decides; OLEDSAVER_LANG=fr|en|zh forces one. Never trust StreamDock's -info language.
function detect() {
  const forced = String(process.env.OLEDSAVER_LANG || "").toLowerCase();
  if (["fr", "en", "zh"].includes(forced)) return forced;
  let l = "";
  try { l = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase(); } catch {}
  return l.startsWith("fr") ? "fr" : l.startsWith("zh") ? "zh" : "en";
}
const LANG = detect();
const TEXTS = {
  en: { screen: "Screen", on: "On", off: "OFF", all: "All", focus: "Focus", auto: "Auto", autoOff: "Off", min: "min",
    none: "No screen", looking: "Looking for screens…", needTwo: "2 screens needed" },
  fr: { screen: "Écran", on: "Allumé", off: "NOIR", all: "Tous", focus: "Focus", auto: "Auto", autoOff: "Inactif", min: "min",
    none: "Pas d'écran", looking: "Recherche des écrans…", needTwo: "2 écrans requis" },
  zh: { screen: "屏幕", on: "开", off: "黑屏", all: "全部", focus: "专注", auto: "自动", autoOff: "关", min: "分钟",
    none: "无屏幕", looking: "正在查找屏幕…", needTwo: "需要 2 个屏幕" },
};
const T = TEXTS[LANG];
const LOCALE = { fr: "fr-FR", en: "en-US", zh: "zh-CN" }[LANG];
module.exports = { LANG, LOCALE, T };
