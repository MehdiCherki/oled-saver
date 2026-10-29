# OLED Saver

StreamDock plugin for the AJAZZ AKP05. Black out or dim any screen, one key per monitor, to protect OLED panels from burn-in.

UUID `com.cherki.oledsaver`. Never change it once the plugin is on the store: users' scenes depend on it.

Born from a request on the community forum: "a plugin to make screen go black to protect OLEDs, triple monitor support".

## How it works

`helper.ps1` (one persistent PowerShell, C# compiled in memory) puts one borderless, always-on-top, never-focused window over a screen:

- **Black** = opaque window that takes the click. The screen stays on and connected, so Windows moves no window (that is why it is not DDC/CI power-off or `SC_MONITORPOWER`, which drops the signal on many OLEDs and throws the windows onto the other screens).
- **Dimmed** (brightness below 100 %) = the same window, see-through and click-through. Software dimming: it does not change the monitor's backlight.
- When the helper or the plugin stops, every window disappears with the process. A screen is never left black across a restart.

## Controls

| Control | Action |
|---|---|
| Keys, slots 0-3 and 7-9 | Screens 1-4 and 5-7, left to right: black out / bring back. A green dot = the mouse is on this screen |
| Key slot 4 | Focus: black out every screen but the one under the mouse; again = bring them back |
| Key slot 5 | All: black out everything; again = bring everything back |
| Key slot 6 | Auto on / off (remembers the last delay) |
| Knob 1 | Turn = brightness of the picked screen (right = brighter), press = black out / bring back |
| Knob 2 | Turn = auto delay (off, 1, 2, 3, 5, 10, 15, 30, 60 min), press = auto on / off |
| Knob 3 | Turn = pick a screen, press = show its number on every screen for 1.5 s |
| Knob 4 | Scene Zapper when it is installed |
| Touchbar | Brightness, auto delay, and a map of the screens at their real places (picked screen = white outline). Tap = black out / bring back the picked screen: StreamDock gives no tap position, so the screen is picked with knob 3 |

Waking a black screen: the key, a **click** on it, or (only for a screen blacked by Auto) the mouse or a focused window coming to it. A key press on the keyboard cannot reach a window that never takes the focus.

**Auto**: a screen goes black when, for the whole delay, the mouse has not been on it, no window on it has had the focus, and its picture has not changed (a 48 x 27 grayscale thumbnail every 6 s, at least 8 cells different = activity; a clock or a caret does not count). Limits: protected video (DRM) is captured black by Windows, so a screen showing only such a video, without the focus and without the mouse, counts as idle.

## Commands

| Command | What it does |
|---|---|
| `node scripts/build.cjs` | Builds `dist/com.cherki.oledsaver.sdPlugin/` and the store zip |
| `node scripts/test-e2e.cjs` | Test with a fake StreamDock and a fake helper (3 screens), pictures in `%TEMP%\oledsaver-test\shots` |
| `node scripts/test-real-helper.cjs [--veil]` | Real helper: lists the screens and samples (read-only). With `--veil`: dims the primary screen to 30 % for 1.5 s, then checks the veil is gone |
| `node install.cjs` | Builds and installs into StreamDock (StreamDock closed) |
| `node scripts/create-scene.cjs` | Creates the "OLED Saver" scene (StreamDock closed), then run SceneNav |
| `node ../_shared/store-check.cjs oled-saver` | Checks the zip before uploading it to the store |

Test switches: `OLEDSAVER_STATE`, `OLEDSAVER_LANG`, `OLEDSAVER_HELPER` (fake helper), `OLEDSAVER_FAKE_DIR`, `OLEDSAVER_AUTO_MS` (length of "1 minute"), `OLEDSAVER_TICK_MS`, `OLEDSAVER_CALL_MS`.

Rules, pitfalls and recipes: `docs/techniques-streamdock.md` at the root of the workspace.
