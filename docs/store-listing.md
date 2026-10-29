# OLED Saver: store listing (Space Station)

| Field | Value |
|---|---|
| Upload | `dist/com.cherki.oledsaver.sdPlugin.zip` (Windows only) |
| Product name | `OLED Saver` |
| Product type | Productivity |
| Support devices | 10 Buttons + 4 Knobs + Screen + Touchbar (AKP05) |
| Language | `Chinese;English` |
| Price | Free (open source, MIT) |
| Version | 1.0.0 |
| Product avatar | `dist/store/avatar-480x480.png` (to make: scripts/store.cjs) |
| Product imgs (in order) | `dist/store/cover-1280x720.png` (to make) |
| System | windows |

## Overview (EN)
```
Protect your OLED monitors from burn-in with one key per screen. Press a key to black out that screen (on an OLED, black pixels are off) while your other screens keep working; press again, or click the black screen, to bring it back. Works with one, two, three or more screens. Focus blacks out every screen except the one with your mouse; All blacks out everything; Auto blacks out a screen by itself when your mouse has not been on it, no window on it has had the focus and its picture has not changed for the delay you choose (1 to 60 minutes), and wakes it as soon as your mouse or a window comes back. Knob 1 sets the brightness of the picked screen, knob 2 the auto delay, knob 3 picks the screen (press to show its number on every screen). The touchbar shows a map of your screens, laid out like on your desk. Nothing to install, no account, no network: a black window is placed over the screen, so the screen stays connected and Windows does not move your windows around. Windows 10/11. English, French, Chinese.
```

## New information (v1.0.0)
```
v1.0.0 – First release
• One key per screen: black out / bring back (up to 7 screens)
• Focus (only the screen under the mouse stays on), All, Auto
• Auto black-out of idle screens (mouse, focus and picture), wakes when the mouse or a window comes back
• Knobs: brightness of the picked screen, auto delay, screen picker
• Touchbar: map of your screens
• Nothing to install, no account; English, French and Chinese
```

## Présentation (FR)
```
Protège tes écrans OLED du marquage avec une touche par écran. Appuie sur une touche pour rendre cet écran noir (sur un OLED, noir = pixels éteints) pendant que les autres continuent de fonctionner ; appuie encore, ou clique sur l'écran noir, pour le rallumer. Fonctionne avec un, deux, trois écrans ou plus. Focus rend noirs tous les écrans sauf celui où se trouve ta souris ; Tous met tout en noir ; Auto rend un écran noir tout seul quand ta souris n'y est pas allée, qu'aucune fenêtre dessus n'a eu le focus et que son image n'a pas changé pendant le délai choisi (1 à 60 minutes), et le rallume dès que ta souris ou une fenêtre revient. La molette 1 règle la luminosité de l'écran choisi, la molette 2 le délai auto, la molette 3 choisit l'écran (appuie pour afficher son numéro sur chaque écran). La touchbar montre le plan de tes écrans, comme sur ton bureau. Rien à installer, aucun compte, aucun réseau : une fenêtre noire est posée sur l'écran, qui reste donc connecté, et Windows ne déplace pas tes fenêtres. Windows 10/11. Français, anglais, chinois.
```

## 简介 (中文)
```
每个屏幕一个按键，保护你的 OLED 显示器免受烧屏。按下按键即可让该屏幕变黑（OLED 上黑色 = 像素熄灭），其他屏幕照常使用；再按一次，或点击黑屏，即可恢复。支持一个、两个、三个或更多屏幕。“专注”让除鼠标所在屏幕外的所有屏幕变黑；“全部”让所有屏幕变黑；“自动”会在你设定的时间（1 到 60 分钟）内，鼠标没有到过该屏幕、屏幕上没有窗口获得焦点且画面没有变化时自动让它变黑，鼠标或窗口回来时立即恢复。旋钮 1 调节所选屏幕的亮度，旋钮 2 设置自动延时，旋钮 3 选择屏幕（按下可在每个屏幕上显示其编号）。触控条显示与你桌面布局一致的屏幕示意图。无需安装、无需账号、无需联网：在屏幕上覆盖一个黑色窗口，屏幕保持连接，Windows 不会移动你的窗口。Windows 10/11。支持中文、英文、法文。
```

Review notes: the plugin puts a borderless black (or see-through, for dimming) always-on-top window over a screen; it never turns the monitor itself off and never changes Windows' display settings, so no window is moved. It does this from a PowerShell helper bundled with the plugin (plugin/helper.ps1, C# compiled in memory with Add-Type, nothing written to disk). The helper also reads where the mouse is and which screen has the focused window (GetCursorPos, GetForegroundWindow) and, only while Auto is on, a 48 x 27 grayscale thumbnail of each screen compared with the previous one to count changed cells; thumbnails are kept in memory only, never saved or sent, and no text, title or key press is read. No network access, no account. The only saved setting is the Auto delay, in %APPDATA%\cherki-oledsaver\state.json. A screen is never left black across a restart: when the plugin or the helper stops, every black window disappears; clicking a black screen also removes it. It works with a single screen (a click brings it back) and needs no setup: place the actions and press a key.
