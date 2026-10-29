// svg-safe.js - makes an SVG safe for resvg, without changing its pixels.
// Copied into each plugin's plugin/ folder by _shared/sync.cjs: edit only the copy in plugins/_shared.
//
// resvg 2.6.2 (the latest @resvg/resvg-js) aborts the WHOLE plugin process (Rust panic, exit code 0xC0000409, cannot
// be caught) when an element that needs its own layer (opacity < 1, clip-path, mask, filter) lies entirely outside
// the rendered area: a cover scrolled off a carousel, a sun glow seen from another key of a panorama...
// Verified 2026-10-27, test: _shared/test-svg-safe.cjs. An empty <text></text> does NOT crash.
//
// safeSvg(svg):
//   - opacity on a shape that paints only its fill (or only its stroke) becomes fill-opacity (stroke-opacity):
//     no layer at all, so it is also cheaper to render;
//   - any other layered element (group, image, use, text, clip-path, mask) gets an invisible anchor rectangle inside
//     its layer, so the layer always meets the canvas (about +0.3 ms per element). The anchor is the canvas itself;
//     under a transform (where canvas coordinates are unknown) it is huge, unless a filter is involved: a huge
//     anchor next to a filtered element makes resvg panic too (seen on Trophy Deck's blurred covers);
//   - empty <text></text> are removed (harmless, keeps the text-layer code simple).
// Filters are left alone: an anchor would grow the filter region (11 ms instead of 0.15 ms, and a slightly
// different blur). Keep filtered elements inside the canvas.
//
// In a plugin:   const { safeSvg } = require("./svg-safe");   ...   new Resvg(safeSvg(svg), options)

const anchorRect = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#000" fill-opacity="0" stroke="none"/>`;
const HUGE = anchorRect(-100000, -100000, 200000, 200000);
const MAYBE_LAYERED = /[\s"'](?:opacity|clip-path|mask)\s*=/;
const SHAPES = new Set(["rect", "circle", "ellipse", "line", "polyline", "polygon", "path"]);
const LEAVES = new Set([...SHAPES, "image", "use", "text"]);
const CONTAINERS = new Set(["g", "a", "svg", "switch"]);
// copied as they are: their content is not drawn directly (or is text)
const OPAQUE = new Set(["defs", "clipPath", "mask", "pattern", "symbol", "marker", "filter", "linearGradient", "radialGradient",
  "style", "script", "title", "desc", "metadata", "foreignObject", "text"]);
const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)([A-Za-z][\w:.-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/g;
const ATTR = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function parseAttrs(s) {
  const m = new Map();
  for (const a of s.matchAll(ATTR)) m.set(a[1], a[2] ?? a[3]);
  return m;
}
const esc = (v) => String(v).replace(/"/g, "&quot;");
const attrText = (m) => [...m].map(([k, v]) => ` ${k}="${esc(v)}"`).join("");
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const round = (n) => Math.round(n * 10000) / 10000;

function layers(at) {
  const op = num(at.get("opacity"), 1);
  const used = (k) => at.has(k) && at.get(k).trim() !== "" && at.get(k).trim() !== "none";
  const r = { opacity: at.has("opacity") && op < 1, clip: used("clip-path"), mask: used("mask") };
  r.any = r.opacity || r.clip || r.mask;
  return r;
}

function safeSvg(svg) {
  if (typeof svg !== "string") return svg;
  svg = svg.replace(/<text\b[^>]*>\s*<\/text>/g, "");
  if (!MAYBE_LAYERED.test(svg)) return svg;
  try { return rewrite(svg); } catch { return svg; }
}

// does the element opened just before `from` contain a filter? (filters are rare: only checked when the SVG has one)
function filterInside(svg, from, name) {
  const re = new RegExp(`<(/?)${name}\\b(?:"[^"]*"|'[^']*'|[^>"'])*?(/?)>`, "g");
  re.lastIndex = from;
  let depth = 1, m;
  while ((m = re.exec(svg))) {
    if (m[2]) continue;
    depth += m[1] ? -1 : 1;
    if (!depth) return svg.slice(from, m.index).includes("filter=");
  }
  return svg.slice(from).includes("filter=");
}

function rewrite(svg) {
  let out = "";
  let last = 0;
  const anyFilter = svg.includes("filter=");
  let canvas = HUGE;   // the root's viewBox (or size), set when the root is read
  // paint state inherited from the open elements (attributes only; a style attribute makes it unknown),
  // tf = under a transform (canvas coordinates unknown), fl = under a filter
  const stack = [{ name: "", fill: "black", stroke: "none", fo: 1, so: 1, unknown: false, close: "", tf: false, fl: false }];
  let opaque = null;   // { name, depth } while copying an OPAQUE element
  let root = true;
  const anchorFor = (transformed, filtered) => (transformed && !filtered ? HUGE : canvas);
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(svg))) {
    const [tok, slash, name, rawAttrs = "", selfClose] = m;
    out += svg.slice(last, m.index);
    last = TOKEN.lastIndex;
    if (!name) { out += tok; continue; }   // comment or CDATA

    if (opaque) {
      if (name === opaque.name && !selfClose) opaque.depth += slash ? -1 : 1;
      if (opaque.depth === 0) {
        out += tok + opaque.close;
        opaque = null;
      } else out += tok;
      continue;
    }

    if (slash) {
      const top = stack[stack.length - 1];
      out += tok;
      if (stack.length > 1 && top.name === name) { out += top.close; stack.pop(); }
      continue;
    }

    const parent = stack[stack.length - 1];
    const at = parseAttrs(rawAttrs);
    const own = {
      name,
      fill: at.has("fill") ? at.get("fill").trim() : parent.fill,
      stroke: at.has("stroke") ? at.get("stroke").trim() : parent.stroke,
      fo: at.has("fill-opacity") ? num(at.get("fill-opacity"), 1) : parent.fo,
      so: at.has("stroke-opacity") ? num(at.get("stroke-opacity"), 1) : parent.so,
      unknown: parent.unknown || at.has("style") || at.has("class"),
      close: "",
      tf: parent.tf || at.has("transform") || (!root && name === "svg"),
      fl: parent.fl || at.has("filter"),
    };

    if (root && name === "svg") {   // the root element itself is never touched
      root = false;
      const vb = (at.get("viewBox") || "").trim().split(/[\s,]+/).map(Number);
      if (vb.length === 4 && vb.every(Number.isFinite)) canvas = anchorRect(...vb);
      else if (num(at.get("width"), 0) > 0 && num(at.get("height"), 0) > 0) canvas = anchorRect(0, 0, num(at.get("width")), num(at.get("height")));
      own.tf = false;
      out += tok;
      if (!selfClose) stack.push(own);
      continue;
    }
    root = false;

    const ly = layers(at);
    let open = tok;
    if (ly.any && CONTAINERS.has(name)) {
      if (!selfClose) open = tok + anchorFor(own.tf, own.fl || (anyFilter && filterInside(svg, last, name)));
    } else if (ly.any && LEAVES.has(name)) {
      const textEnd = name === "text" ? svg.indexOf("</text>", last) : -1;
      const inner = textEnd >= 0 ? svg.slice(last, textEnd) : "";
      const plain = ly.opacity && !ly.clip && !ly.mask && !own.unknown && !at.has("filter")
        && !at.has("marker-start") && !at.has("marker-mid") && !at.has("marker-end")
        && (name !== "text" || !/\b(?:fill|stroke|style|class|opacity)\s*=/.test(inner))
        && (SHAPES.has(name) || name === "text");
      const paintsFill = name !== "line" && own.fill !== "none" && own.fill !== "transparent";
      const paintsStroke = own.stroke !== "none" && own.stroke !== "transparent" && at.get("stroke-width") !== "0";
      if (plain && !(paintsFill && paintsStroke)) {
        // one paint only: opacity == that paint's opacity, no layer needed
        const op = num(at.get("opacity"), 1);
        at.delete("opacity");
        if (paintsFill) at.set("fill-opacity", round(own.fo * op));
        else if (paintsStroke) at.set("stroke-opacity", round(own.so * op));
        open = `<${name}${attrText(at)}${selfClose ? "/" : ""}>`;
      } else {
        // the layer moves to a wrapper group (with the transform, so clip / mask coordinates stay the same)
        const wrap = new Map();
        for (const k of ["transform", "opacity", "clip-path", "mask"]) if (at.has(k)) { wrap.set(k, at.get(k)); at.delete(k); }
        const anchor = anchorFor(own.tf, own.fl);
        open = `<g${attrText(wrap)}><${name}${attrText(at)}${selfClose ? "/" : ""}>`;
        if (selfClose) open += anchor + "</g>";
        else own.close = anchor + "</g>";
      }
    }
    out += open;
    if (selfClose) continue;
    if (OPAQUE.has(name)) {
      opaque = { name, depth: 1, close: own.close };
      continue;
    }
    stack.push(own);
  }
  return out + svg.slice(last);
}

module.exports = { safeSvg };
