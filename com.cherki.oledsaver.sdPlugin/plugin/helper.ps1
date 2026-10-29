# OLED Saver - draws the black / dimming veils over the screens for the plugin (Windows APIs only, nothing to install).
#   One borderless, always-on-top, never-focused window per screen. Black = a window that covers the screen (the screen
#   stays on and connected, so Windows moves no window); dimming = the same window, see-through and click-through.
#   A click on a black veil removes it. When this process ends (the plugin stops, StreamDock closes) every veil goes away.
# Read-only for the rest of the PC: it never injects keys or reads what is on a screen, except a 48 x 27 thumbnail
# compared with the previous one (how many cells changed) to know if a screen is idle. Thumbnails are never stored.
# stdin: one JSON command per line. stdout: one JSON line per answer {"t": ..., "n": <request number>}, plus pushed
# lines {"t":"click","device":...} and {"t":"screens"} (screens plugged / unplugged / moved).
# Written for Windows PowerShell 5 (C# 5): no =>, ?. or $"" in the C# below.
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing, System.Web.Extensions -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using WinTimer = System.Windows.Forms.Timer;

public class Veil : Form {
  const int WS_EX_TOOLWINDOW = 0x80, WS_EX_NOACTIVATE = 0x08000000, WS_EX_TOPMOST = 0x8, WS_EX_TRANSPARENT = 0x20, WS_EX_LAYERED = 0x80000;
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h, int i, int v);
  [DllImport("user32.dll")] static extern bool SetLayeredWindowAttributes(IntPtr h, uint key, byte alpha, uint flags);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern IntPtr SetCursor(IntPtr c);
  public string Device; public Rectangle Want; public int Level; public string Label; public bool ClickThrough;

  public Veil(string device) {
    Device = device;
    FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; StartPosition = FormStartPosition.Manual;
    BackColor = Color.Black; TopMost = true;
  }
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override CreateParams CreateParams {
    get { CreateParams cp = base.CreateParams; cp.ExStyle |= WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST | WS_EX_LAYERED; return cp; }
  }
  protected override void WndProc(ref Message m) {
    if (m.Msg == 0x02E0) return;   // WM_DPICHANGED: WinForms would resize the window, we keep our exact rectangle
    if (m.Msg == 0x0020 && !ClickThrough && Level >= 100) { SetCursor(IntPtr.Zero); m.Result = (IntPtr)1; return; }   // WM_SETCURSOR: no pointer over a black veil
    base.WndProc(ref m);
  }
  // level 0 = hidden, 1-99 = see-through and click-through, 100 = opaque black that takes the click
  public void Apply(int level) {
    Level = level;
    IntPtr h = Handle;
    if (level <= 0) { ShowWindow(h, 0); return; }
    int ex = GetWindowLong(h, -20);
    ex = (level >= 100 && !ClickThrough) ? (ex & ~WS_EX_TRANSPARENT) : (ex | WS_EX_TRANSPARENT);
    SetWindowLong(h, -20, ex);
    SetLayeredWindowAttributes(h, 0, (byte)Math.Min(255, level * 255 / 100), 2);
    SetWindowPos(h, (IntPtr)(-1), Want.X, Want.Y, Want.Width, Want.Height, 0x10 | 0x40);   // TOPMOST, no activate, show
    Invalidate();
  }
  public void Reassert() { if (Level > 0) SetWindowPos(Handle, (IntPtr)(-1), 0, 0, 0, 0, 0x10 | 0x02 | 0x01); }   // the taskbar may climb back over us
  protected override void OnMouseDown(MouseEventArgs e) { if (!ClickThrough && Level >= 100) Oled.Clicked(Device); }
  protected override void OnPaint(PaintEventArgs e) {
    if (Label == null) return;
    using (Font f = new Font("Segoe UI", Math.Max(40, Height / 4), FontStyle.Bold, GraphicsUnit.Pixel))
    using (StringFormat sf = new StringFormat()) {
      sf.Alignment = StringAlignment.Center; sf.LineAlignment = StringAlignment.Center;
      e.Graphics.DrawString(Label, f, Brushes.White, new RectangleF(0, 0, Width, Height), sf);
    }
  }
}

public static class Oled {
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int x, y; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct MONITORINFOEX { public int cbSize; public int l, t, r, b, wl, wt, wr, wb; public uint dwFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice; }
  [StructLayout(LayoutKind.Sequential)] struct BITMAPINFOHEADER { public int biSize, biWidth, biHeight; public short biPlanes, biBitCount; public int biCompression, biSizeImage, biXPelsPerMeter, biYPelsPerMeter, biClrUsed, biClrImportant; }
  delegate bool MonEnum(IntPtr hMon, IntPtr hdc, IntPtr rect, IntPtr data);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonEnum cb, IntPtr data);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr hMon, ref MONITORINFOEX mi);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(POINT pt, uint flags);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT pt);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
  [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern IntPtr CreateDIBSection(IntPtr dc, ref BITMAPINFOHEADER bi, uint usage, out IntPtr bits, IntPtr section, uint offset);
  [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr obj);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
  [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern int SetStretchBltMode(IntPtr dc, int mode);
  [DllImport("gdi32.dll")] static extern bool StretchBlt(IntPtr dst, int x, int y, int w, int h, IntPtr src, int sx, int sy, int sw, int sh, uint rop);

  class Scr { public IntPtr h; public string device; public Rectangle r; public bool primary; }
  const int CW = 48, CH = 27, CELL_DELTA = 12;
  static readonly object wlock = new object();
  static Stream so;
  static Control host;
  static WinTimer topTimer;
  static readonly Dictionary<string, Veil> veils = new Dictionary<string, Veil>();
  static readonly Dictionary<string, byte[]> prev = new Dictionary<string, byte[]>();
  static readonly List<Veil> idents = new List<Veil>();
  static readonly JavaScriptSerializer ser = new JavaScriptSerializer();

  static string Q(string s) {
    StringBuilder b = new StringBuilder("\"");
    foreach (char c in s) { if (c == '\\' || c == '"') b.Append('\\').Append(c); else if (c < 32) b.Append(' '); else b.Append(c); }
    return b.Append('"').ToString();
  }
  static void Emit(string json) {
    lock (wlock) { byte[] b = Encoding.UTF8.GetBytes(json + "\n"); so.Write(b, 0, b.Length); so.Flush(); }
  }

  static List<Scr> Screens() {
    List<Scr> l = new List<Scr>();
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate(IntPtr hm, IntPtr hdc, IntPtr rc, IntPtr d) {
      MONITORINFOEX mi = new MONITORINFOEX(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFOEX));
      if (GetMonitorInfo(hm, ref mi)) { Scr s = new Scr(); s.h = hm; s.device = mi.szDevice; s.r = Rectangle.FromLTRB(mi.l, mi.t, mi.r, mi.b); s.primary = (mi.dwFlags & 1) != 0; l.Add(s); }
      return true;
    }, IntPtr.Zero);
    l.Sort(delegate(Scr a, Scr b) { return a.r.X != b.r.X ? a.r.X.CompareTo(b.r.X) : a.r.Y.CompareTo(b.r.Y); });
    return l;
  }
  static string DeviceOf(IntPtr hm, List<Scr> l) { foreach (Scr s in l) if (s.h == hm) return s.device; return ""; }
  static int LevelOf(string dev) { Veil v; return veils.TryGetValue(dev, out v) ? v.Level : 0; }

  // a 48 x 27 luminance thumbnail of the screen; returns how many cells differ from the previous thumbnail (-1 the first time)
  static int Sample(Scr s) {
    IntPtr sdc = GetDC(IntPtr.Zero), mdc = CreateCompatibleDC(sdc), bmp = IntPtr.Zero, old = IntPtr.Zero;
    try {
      BITMAPINFOHEADER bi = new BITMAPINFOHEADER(); bi.biSize = Marshal.SizeOf(typeof(BITMAPINFOHEADER)); bi.biWidth = CW; bi.biHeight = -CH; bi.biPlanes = 1; bi.biBitCount = 32;
      IntPtr bits; bmp = CreateDIBSection(sdc, ref bi, 0, out bits, IntPtr.Zero, 0);
      if (bmp == IntPtr.Zero) return -1;
      old = SelectObject(mdc, bmp);
      SetStretchBltMode(mdc, 4);   // HALFTONE: averages instead of skipping pixels
      if (!StretchBlt(mdc, 0, 0, CW, CH, sdc, s.r.X, s.r.Y, s.r.Width, s.r.Height, 0x00CC0020)) return -1;
      byte[] px = new byte[CW * CH * 4]; Marshal.Copy(bits, px, 0, px.Length);
      byte[] lum = new byte[CW * CH];
      for (int i = 0; i < lum.Length; i++) lum[i] = (byte)((px[i * 4 + 2] * 3 + px[i * 4 + 1] * 6 + px[i * 4]) / 10);
      byte[] p; int changed = -1;
      if (prev.TryGetValue(s.device, out p)) { changed = 0; for (int i = 0; i < lum.Length; i++) if (Math.Abs(lum[i] - p[i]) > CELL_DELTA) changed++; }
      prev[s.device] = lum;
      return changed;
    } finally {
      if (old != IntPtr.Zero) SelectObject(mdc, old);
      if (bmp != IntPtr.Zero) DeleteObject(bmp);
      DeleteDC(mdc); ReleaseDC(IntPtr.Zero, sdc);
    }
  }

  static bool SetLevel(string dev, int level) {
    level = Math.Max(0, Math.Min(100, level));
    Scr scr = null; foreach (Scr s in Screens()) if (s.device == dev) scr = s;
    if (scr == null) return false;
    Veil v;
    if (!veils.TryGetValue(dev, out v)) { v = new Veil(dev); veils[dev] = v; }
    v.Want = scr.r; v.Apply(level);
    TopTimer();
    return true;
  }
  static void TopTimer() {
    bool any = false; foreach (Veil v in veils.Values) if (v.Level > 0) any = true;
    topTimer.Enabled = any;
  }
  // screens plugged / unplugged / moved: put every veil back on its screen, drop those whose screen is gone
  static void Layout() {
    List<Scr> now = Screens();
    foreach (string dev in new List<string>(veils.Keys)) {
      Scr scr = null; foreach (Scr s in now) if (s.device == dev) scr = s;
      Veil v = veils[dev];
      if (scr == null) { v.Apply(0); v.Close(); veils.Remove(dev); prev.Remove(dev); }
      else { v.Want = scr.r; if (v.Level > 0) v.Apply(v.Level); }
    }
    TopTimer();
    Emit("{\"t\":\"screens\"}");
  }
  public static void Clicked(string dev) {
    Veil v; if (veils.TryGetValue(dev, out v)) v.Apply(0);
    TopTimer();
    Emit("{\"t\":\"click\",\"device\":" + Q(dev) + "}");
  }

  static string Handle(Dictionary<string, object> d) {
    string cmd = (string)d["cmd"]; string n = d.ContainsKey("n") ? Convert.ToString(d["n"]) : "0";
    switch (cmd) {
      case "list": {
        bool sample = d.ContainsKey("sample") && (bool)d["sample"];
        List<Scr> l = Screens(); POINT pt; GetCursorPos(out pt);
        string cur = DeviceOf(MonitorFromPoint(pt, 0), l);
        IntPtr fg = GetForegroundWindow();
        string fgDev = fg == IntPtr.Zero ? "" : DeviceOf(MonitorFromWindow(fg, 2), l);
        StringBuilder sb = new StringBuilder("{\"t\":\"list\",\"n\":" + n + ",\"cursor\":" + Q(cur) + ",\"fg\":" + Q(fgDev) + ",\"screens\":[");
        for (int i = 0; i < l.Count; i++) {
          Scr s = l[i]; int lv = LevelOf(s.device);
          sb.Append(i > 0 ? "," : "").Append("{\"device\":").Append(Q(s.device)).Append(",\"x\":").Append(s.r.X).Append(",\"y\":").Append(s.r.Y)
            .Append(",\"w\":").Append(s.r.Width).Append(",\"h\":").Append(s.r.Height).Append(",\"primary\":").Append(s.primary ? "true" : "false").Append(",\"level\":").Append(lv);
          if (sample && lv < 100) { int c = Sample(s); if (c >= 0) sb.Append(",\"changed\":").Append(c); }
          sb.Append("}");
        }
        foreach (Veil v in veils.Values) v.Reassert();
        return sb.Append("]}").ToString();
      }
      case "level": return "{\"t\":\"level\",\"n\":" + n + ",\"ok\":" + (SetLevel((string)d["device"], Convert.ToInt32(d["level"])) ? "true" : "false") + "}";
      case "clear": foreach (Veil v in veils.Values) v.Apply(0); TopTimer(); return "{\"t\":\"clear\",\"n\":" + n + "}";
      case "ident": {
        Dictionary<string, object> labels = (Dictionary<string, object>)d["labels"];
        int ms = d.ContainsKey("ms") ? Convert.ToInt32(d["ms"]) : 1500;
        foreach (Veil o in idents) o.Close();
        idents.Clear();
        foreach (Scr s in Screens()) {
          if (!labels.ContainsKey(s.device)) continue;
          Veil v = new Veil("ident"); v.ClickThrough = true; v.Label = Convert.ToString(labels[s.device]); v.Want = s.r; v.Apply(70); idents.Add(v);
        }
        WinTimer t = new WinTimer(); t.Interval = Math.Max(300, Math.Min(5000, ms));
        t.Tick += delegate(object a, EventArgs e) { t.Stop(); t.Dispose(); foreach (Veil o in idents) o.Close(); idents.Clear(); };
        t.Start();
        return "{\"t\":\"ident\",\"n\":" + n + "}";
      }
      case "ping": return "{\"t\":\"pong\",\"n\":" + n + "}";
      default: return "{\"t\":\"error\",\"n\":" + n + ",\"err\":" + Q("unknown " + cmd) + "}";
    }
  }

  public static void Run() {
    so = Console.OpenStandardOutput();
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }   // per-monitor v2: real pixels on every screen
    ManualResetEvent ready = new ManualResetEvent(false);
    Thread ui = new Thread(delegate() {
      host = new Control(); IntPtr hh = host.Handle;
      topTimer = new WinTimer(); topTimer.Interval = 2000;
      topTimer.Tick += delegate(object a, EventArgs e) { foreach (Veil v in veils.Values) v.Reassert(); };
      WinTimer settle = new WinTimer(); settle.Interval = 600;
      settle.Tick += delegate(object a, EventArgs e) { settle.Stop(); Layout(); };
      Microsoft.Win32.SystemEvents.DisplaySettingsChanged += delegate(object a, EventArgs e) { host.BeginInvoke((MethodInvoker)delegate { settle.Stop(); settle.Start(); }); };
      ready.Set();
      Application.Run(new ApplicationContext());
    });
    ui.SetApartmentState(ApartmentState.STA); ui.IsBackground = true; ui.Start();
    ready.WaitOne();
    StreamReader input = new StreamReader(Console.OpenStandardInput(), Encoding.UTF8);
    string line;
    while ((line = input.ReadLine()) != null) {
      if (line.Trim().Length == 0) continue;
      string answer = null; string l2 = line;
      try {
        host.Invoke((MethodInvoker)delegate {
          try { answer = Handle((Dictionary<string, object>)ser.DeserializeObject(l2)); }
          catch (Exception ex) { answer = "{\"t\":\"error\",\"n\":0,\"err\":" + Q(ex.Message) + "}"; }
        });
      } catch (Exception ex) { answer = "{\"t\":\"error\",\"n\":0,\"err\":" + Q(ex.Message) + "}"; }
      if (answer != null) Emit(answer);
    }
    // stdin closed: the plugin is gone, take every veil down before leaving
    try { host.Invoke((MethodInvoker)delegate { foreach (Veil v in veils.Values) { v.Apply(0); v.Close(); } foreach (Veil v in idents) v.Close(); Application.ExitThread(); }); } catch { }
  }
}
'@
[Oled]::Run()
