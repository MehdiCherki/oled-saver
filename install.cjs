// Builds OLED Saver and installs it into StreamDock.
// Usage (StreamDock closed):  node install.cjs   then, once:  node scripts/create-scene.cjs  (then SceneNav nav.cjs)
const fs = require("fs");
const path = require("path");
const { PLUGINS, requireStreamDockClosed } = require("./scripts/common.cjs");
const { build, NAME } = require("./scripts/build.cjs");

requireStreamDockClosed();
const out = build();
const target = path.join(PLUGINS, NAME);
fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(out, target, { recursive: true });
console.log("✅ Installed:", target);
