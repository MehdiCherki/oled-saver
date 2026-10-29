// Creates the "OLED Saver" scene on the AKP05: the key action on the 10 keys, the knob action on the 4 knobs and the
// touchbar action on the whole touchbar. StreamDock must be closed. Then run SceneNav:
//   node "..\..\sdk\StreamDock-Plugin-SDK\SceneNav\nav.cjs"
const { action, createScene } = require("./common.cjs");

const ID = "com.cherki.oledsaver";
const keys = {};
for (let slot = 0; slot < 10; slot++) keys[slot] = action(`${ID}.key`, "OLED Saver – Key", {}, "Keypad");
createScene("OLED Saver", {
  keys,
  knobs: [0, 1, 2, 3].map(() => action(`${ID}.knob`, "OLED Saver – Knob", {}, "Knob")),
  touchbar: [action(`${ID}.strip`, "OLED Saver – Touchbar", { touchbarWidth: 750 }, "Keypad")],
});
