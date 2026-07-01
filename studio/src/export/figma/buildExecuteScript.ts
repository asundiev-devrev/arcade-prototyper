// studio/src/export/figma/buildExecuteScript.ts
import type { SljDocument } from "../slj";
import { sljToExecutePlan, type ExecutePlanMaps } from "./executePlan";

/** Fixed runtime that runs in the Figma plugin sandbox. Reads global __PLAN__,
 *  builds frames (auto-layout) + real component instances (local-node resolve,
 *  variant, label, icon swap, token fill). Best-effort per node. Returns a
 *  summary. Plain ES5-ish JS — no optional chaining, no nullish coalescing, no TS. */
const RUNTIME = `
var IMPORT_TIMEOUT_MS = 20000;
var made = { frames: 0, instances: 0, icons: 0, binds: 0, fail: 0 };
var errs = [];
var setCache = {};
var fonts = {};
var varCache = {};

function withTimeout(p, ms) {
  return Promise.race([
    p,
    new Promise(function (resolve) { setTimeout(function () { resolve(null); }, ms); })
  ]);
}

function collectKeys(node, acc) {
  if (node.kind === "instance") {
    if (node.componentSetKey) acc.sets[node.componentSetKey] = node.setName || "";
    if (node.iconSetKey) acc.sets[node.iconSetKey] = node.iconSetName || "";
  }
  if (node.fillVariableKey) acc.vars[node.fillVariableKey] = true;
  var kids = node.children || [];
  for (var i = 0; i < kids.length; i++) collectKeys(kids[i], acc);
  return acc;
}

async function importSetByKey(key) {
  var viaSet = withTimeout(figma.importComponentSetByKeyAsync(key).catch(function(){ return null; }), IMPORT_TIMEOUT_MS);
  var viaComp = withTimeout(figma.importComponentByKeyAsync(key).catch(function(){ return null; }), IMPORT_TIMEOUT_MS);
  var results = await Promise.all([viaSet, viaComp]);
  return results[0] || results[1] || null;
}

async function getLocalSet(key, setName) {
  if (setCache[key] !== undefined) return setCache[key];
  var found = await importSetByKey(key);
  if (!found) {
    var all = figma.root.findAllWithCriteria ? figma.root.findAllWithCriteria({ types: ["COMPONENT_SET"] }) : [];
    for (var i = 0; i < all.length; i++) { if (all[i].key === key) { found = all[i]; break; } }
    if (!found && setName) {
      for (var j = 0; j < all.length; j++) {
        if (all[j].name === setName && !/DEPREC|DLS|WIP/.test(all[j].name)) { found = all[j]; break; }
      }
    }
  }
  setCache[key] = found;
  return found;
}

function pickVariant(set, variant) {
  if (set.type === "COMPONENT") return set;
  var comps = set.children.filter(function (c) { return c.type === "COMPONENT"; });
  if (variant) {
    for (var i = 0; i < comps.length; i++) {
      var vp = comps[i].variantProperties || {};
      var ok = true;
      for (var k in variant) { if (vp[k] !== variant[k]) { ok = false; break; } }
      if (ok) return comps[i];
    }
  }
  return set.defaultVariant || comps[0] || null;
}

async function ensureFont(fn) {
  var k = fn.family + "|" + fn.style;
  if (fonts[k]) return fonts[k];
  try { await figma.loadFontAsync(fn); fonts[k] = fn; return fn; } catch (e) { return null; }
}

async function setLabel(inst, propName, chars) {
  if (propName) {
    try {
      var defs = inst.componentProperties || {};
      var base = propName.split("#")[0];
      for (var key in defs) {
        if (defs[key].type === "TEXT" && (key === propName || key.split("#")[0] === base)) {
          var p = {}; p[key] = chars; inst.setProperties(p); return;
        }
      }
    } catch (e) {}
  }
  var texts = inst.findAll ? inst.findAll(function (n) { return n.type === "TEXT"; }) : [];
  if (!texts.length) return;
  texts.sort(function (a, b) { return (b.width * b.height) - (a.width * a.height); });
  var t = texts[0];
  var okFont = await ensureFont(t.fontName);
  if (!okFont) return;
  try { t.characters = chars; } catch (e) {}
}

async function setIcon(inst, iconKey, iconName) {
  var child = inst.findOne ? inst.findOne(function (n) { return n.type === "INSTANCE" && /Icons\\//.test(n.name); }) : null;
  if (!child) return;
  var set = await getLocalSet(iconKey, iconName);
  if (!set || !set.children) return;
  var comps = set.children.filter(function (c) { return c.type === "COMPONENT"; });
  var target = null;
  for (var i = 0; i < comps.length; i++) { if ((comps[i].variantProperties || {}).Size === "16") { target = comps[i]; break; } }
  if (!target) target = set.defaultVariant || comps[0];
  if (target) { try { child.swapComponent(target); } catch (e) {} }
}

async function bindFill(node, varKey) {
  if (!("fills" in node)) return;
  var v = varCache[varKey];
  if (v === undefined) { try { v = await withTimeout(figma.variables.importVariableByKeyAsync(varKey), IMPORT_TIMEOUT_MS); } catch (e) { v = null; } varCache[varKey] = v; }
  if (!v || v.resolvedType !== "COLOR") return;
  try {
    var base = (node.fills && node.fills[0]) ? Object.assign({}, node.fills[0]) : { type: "SOLID", color: { r: 0, g: 0, b: 0 } };
    node.fills = [figma.variables.setBoundVariableForPaint(base, "color", v)];
    made.binds++;
  } catch (e) {}
}

function setSolid(node, color) {
  if (!("fills" in node)) return;
  var m = String(color).match(/rgba?\\(([^)]+)\\)/);
  var rgb = null;
  if (m) { var p = m[1].split(",").map(function (s) { return parseFloat(s.trim()); }); rgb = { r: p[0]/255, g: p[1]/255, b: p[2]/255, a: p[3] == null ? 1 : p[3] }; }
  else if (color[0] === "#") { var h = color.slice(1); rgb = { r: parseInt(h.slice(0,2),16)/255, g: parseInt(h.slice(2,4),16)/255, b: parseInt(h.slice(4,6),16)/255, a: 1 }; }
  if (rgb) { try { node.fills = [{ type: "SOLID", color: { r: rgb.r, g: rgb.g, b: rgb.b }, opacity: rgb.a }]; } catch (e) {} }
}

function parseColor(color) {
  var m = String(color).match(/rgba?\\(([^)]+)\\)/);
  if (m) { var p = m[1].split(",").map(function (s) { return parseFloat(s.trim()); }); return { r: p[0]/255, g: p[1]/255, b: p[2]/255, a: p[3] == null ? 1 : p[3] }; }
  if (color[0] === "#") { var h = color.slice(1); return { r: parseInt(h.slice(0,2),16)/255, g: parseInt(h.slice(2,4),16)/255, b: parseInt(h.slice(4,6),16)/255, a: 1 }; }
  return { r: 0, g: 0, b: 0, a: 1 };
}

function b64decode(str) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var lookup = {}; for (var i = 0; i < chars.length; i++) lookup[chars[i]] = i;
  var clean = str.replace(/[^A-Za-z0-9+\\/=]/g, "");
  var len = clean.length;
  var padding = clean[len - 2] === "=" ? 2 : (clean[len - 1] === "=" ? 1 : 0);
  var bytes = new Uint8Array((len * 3 / 4) - padding);
  var j = 0;
  for (var k = 0; k < len; k += 4) {
    var a = lookup[clean[k]] || 0, b = lookup[clean[k+1]] || 0, c = lookup[clean[k+2]] || 0, d = lookup[clean[k+3]] || 0;
    var triplet = (a << 18) | (b << 12) | (c << 6) | d;
    if (j < bytes.length) bytes[j++] = (triplet >> 16) & 0xFF;
    if (j < bytes.length) bytes[j++] = (triplet >> 8) & 0xFF;
    if (j < bytes.length) bytes[j++] = triplet & 0xFF;
  }
  return bytes;
}

function applyCorners(f, node) {
  // Per-corner radius when corners differ; else uniform cornerRadius. Individual
  // corner setters are best-effort — fall back to the uniform radius.
  if (node.corners) {
    var c = node.corners;
    var ok = false;
    try { f.topLeftRadius = c.tl; f.topRightRadius = c.tr; f.bottomRightRadius = c.br; f.bottomLeftRadius = c.bl; ok = true; } catch (e) {}
    if (!ok) { try { f.cornerRadius = Math.max(c.tl, c.tr, c.br, c.bl); } catch (e2) {} }
    return;
  }
  if (node.cornerRadius) { try { f.cornerRadius = node.cornerRadius; } catch (e) {} }
}

function applyBorders(f, borders) {
  if (!borders || !("strokes" in f)) return;
  var sides = ["top", "right", "bottom", "left"];
  var firstColor = null;
  var maxW = 0;
  var weights = { top: 0, right: 0, bottom: 0, left: 0 };
  for (var i = 0; i < sides.length; i++) {
    var side = borders[sides[i]];
    if (side && side.width > 0) {
      weights[sides[i]] = side.width;
      if (side.width > maxW) maxW = side.width;
      if (!firstColor) firstColor = side.color;
    }
  }
  if (!firstColor) return;
  var col = parseColor(firstColor);
  try { f.strokes = [{ type: "SOLID", color: { r: col.r, g: col.g, b: col.b }, opacity: col.a }]; } catch (e) { return; }
  // Try per-side weights; fall back to a uniform strokeWeight (max side) if the
  // individual setters throw (older API / node type without side weights).
  var perSideOk = true;
  try {
    f.strokeTopWeight = weights.top; f.strokeRightWeight = weights.right;
    f.strokeBottomWeight = weights.bottom; f.strokeLeftWeight = weights.left;
  } catch (e2) { perSideOk = false; }
  if (!perSideOk) { try { f.strokeWeight = maxW; } catch (e3) {} }
}

function applyLayout(frame, layout) {
  if (!layout) { frame.layoutMode = "NONE"; return; }
  frame.layoutMode = layout.mode === "horizontal" ? "HORIZONTAL" : "VERTICAL";
  frame.itemSpacing = layout.gap || 0;
  var pad = layout.padding || [0,0,0,0];
  frame.paddingTop = pad[0]; frame.paddingRight = pad[1]; frame.paddingBottom = pad[2]; frame.paddingLeft = pad[3];
  frame.counterAxisAlignItems = layout.align === "center" ? "CENTER" : (layout.align === "end" ? "MAX" : "MIN");
  frame.primaryAxisSizingMode = "FIXED"; frame.counterAxisSizingMode = "FIXED";
}

async function build(node, parent, ox, oy) {
  if (node.kind === "instance") {
    var set = await getLocalSet(node.componentSetKey, node.setName);
    if (!set) { made.fail++; if (errs.length < 12) errs.push("set " + node.setName); return; }
    var comp = pickVariant(set, node.variant ? node.variant : null);
    if (!comp) { made.fail++; return; }
    var inst = comp.createInstance();
    parent.appendChild(inst);
    // Resize to the DOM box. For TEXT-BEARING instances (Bubble, etc.) the
    // wrapped label can need more height than the DOM box measured, and these
    // components ship with an AUTO height axis — forcing it FIXED clips the 2nd
    // line. So when this node carries text, restore the height axis to AUTO if
    // it started AUTO, letting the box grow to fit. Gating on node.text is
    // important: components like Menu also hug VERTICAL, but to a huge natural
    // height (a full dropdown) — they have no text payload, so they stay at the
    // DOM box and don't balloon. Fixed components (IconButton) stay fixed too.
    var primMode = inst.primaryAxisSizingMode;
    var counterMode = inst.counterAxisSizingMode;
    var layoutMode = inst.layoutMode;
    try { if (node.box.width > 0 && node.box.height > 0) inst.resize(node.box.width, node.box.height); } catch (e) {}
    if (node.text) {
      try {
        if (layoutMode === "VERTICAL" && primMode === "AUTO") inst.primaryAxisSizingMode = "AUTO";
        else if (layoutMode === "HORIZONTAL" && counterMode === "AUTO") inst.counterAxisSizingMode = "AUTO";
      } catch (e) {}
    }
    inst.x = node.box.x - ox; inst.y = node.box.y - oy;
    if (node.text) await setLabel(inst, node.text.propName ? node.text.propName : null, node.text.characters);
    if (node.iconSetKey) { await setIcon(inst, node.iconSetKey, node.iconSetName ? node.iconSetName : ""); made.icons++; }
    made.instances++;
    return;
  }
  if (node.kind === "svg") {
    var sv = null;
    try { sv = figma.createNodeFromSvg(node.markup); } catch (e) { sv = null; }
    if (sv) {
      parent.appendChild(sv);
      sv.x = node.box.x - ox; sv.y = node.box.y - oy;
      try { if (node.box.width > 0 && node.box.height > 0) sv.resize(node.box.width, node.box.height); } catch (e) {}
      made.icons++;
      return;
    }
    // fall through to empty frame if parse failed
  }
  if (node.kind === "image") {
    try {
      var imgBytes = b64decode(node.data);
      var imgRef = figma.createImage(imgBytes);
      var imgFrame = figma.createFrame();
      imgFrame.name = "image";
      imgFrame.fills = [{ type: "IMAGE", imageHash: imgRef.hash, scaleMode: "FILL" }];
      imgFrame.clipsContent = true;
      if (node.cornerRadius) { try { imgFrame.cornerRadius = node.cornerRadius; } catch (e) {} }
      parent.appendChild(imgFrame);
      try { imgFrame.resizeWithoutConstraints(Math.max(node.box.width, 1), Math.max(node.box.height, 1)); } catch (e) {}
      imgFrame.x = node.box.x - ox; imgFrame.y = node.box.y - oy;
      made.frames++;
    } catch (e) {
      var fallback = figma.createFrame();
      fallback.name = "image (failed)";
      fallback.fills = [];
      parent.appendChild(fallback);
      try { fallback.resizeWithoutConstraints(Math.max(node.box.width, 1), Math.max(node.box.height, 1)); } catch (e2) {}
      fallback.x = node.box.x - ox; fallback.y = node.box.y - oy;
      made.frames++;
    }
    return;
  }
  if (node.kind === "text") {
    var t = figma.createText();
    parent.appendChild(t);
    var famRaw = node.fontFamily ? String(node.fontFamily).split(",")[0].replace(/["']/g,"").trim() : "";
    var fam = famRaw || "Inter";
    var wnum = node.fontWeight || 400;
    var style = wnum >= 650 ? "Bold" : (wnum >= 550 ? "Semi Bold" : (wnum >= 450 ? "Medium" : "Regular"));
    var loaded = await ensureFont({ family: fam, style: style });
    if (!loaded) loaded = await ensureFont({ family: "Inter", style: "Regular" });
    if (loaded) { try { t.fontName = loaded; } catch (e) {} }
    try { t.characters = node.characters; } catch (e) {}
    if (node.fontSize) { try { t.fontSize = node.fontSize; } catch (e) {} }
    if (node.lineHeight) { try { t.lineHeight = { value: node.lineHeight, unit: "PIXELS" }; } catch (e) {} }
    if (node.wrap && node.box.width > 0) { try { t.textAutoResize = "HEIGHT"; t.resize(node.box.width, t.height); } catch (e) {} }
    t.x = node.box.x - ox; t.y = node.box.y - oy;
    if (node.fillVariableKey) { await bindFill(t, node.fillVariableKey); } else if (node.fillColor) { setSolid(t, node.fillColor); }
    return;
  }
  var f = figma.createFrame();
  f.name = "frame";
  if (node.name) { try { f.name = node.name; } catch (e) {} }
  f.fills = [];
  f.clipsContent = node.clip ? true : false;
  applyLayout(f, node.layout);
  applyCorners(f, node);
  applyBorders(f, node.borders);
  if (node.shadow) {
    var sc = parseColor(node.shadow.color);
    f.effects = [{ type: "DROP_SHADOW", color: { r: sc.r, g: sc.g, b: sc.b, a: sc.a }, offset: { x: node.shadow.x, y: node.shadow.y }, radius: node.shadow.blur, spread: node.shadow.spread, visible: true, blendMode: "NORMAL" }];
  }
  if (node.opacity != null && node.opacity < 1) { f.opacity = node.opacity; }
  parent.appendChild(f);
  try { f.resizeWithoutConstraints(Math.max(node.box.width, 1), Math.max(node.box.height, 1)); } catch (e) {}
  f.x = node.box.x - ox; f.y = node.box.y - oy;
  // CSS rotate() is clockwise-positive; Figma rotation is counterclockwise-positive.
  // Apply after positioning; small illustration cards read as layered/rotated.
  if (node.rotation) { try { f.rotation = -node.rotation; } catch (e) {} }
  if (node.fillVariableKey) { await bindFill(f, node.fillVariableKey); } else if (node.fillColor) { setSolid(f, node.fillColor); }
  made.frames++;
  var childOx = node.layout ? ox : node.box.x;
  var childOy = node.layout ? oy : node.box.y;
  for (var i = 0; i < node.children.length; i++) { await build(node.children[i], f, childOx, childOy); }
}

// Size the wrapper to the widest/tallest descendant box in the plan, NOT to
// __root.box — the outer DOM container often measures 0x0 and would collapse
// the wrapper to 1x1, clipping everything inside. clipsContent=false is a
// second safety net so an off-by-a-bit box never hides content again.
function planBounds(node, ox, oy, acc) {
  var x = node.box.x - ox, y = node.box.y - oy;
  if (node.box.width > 0 && node.box.height > 0) {
    if (x + node.box.width > acc.w) acc.w = x + node.box.width;
    if (y + node.box.height > acc.h) acc.h = y + node.box.height;
  }
  for (var i = 0; i < (node.children ? node.children.length : 0); i++) planBounds(node.children[i], ox, oy, acc);
  return acc;
}

var __root = __PLAN__.root;

var __keys = collectKeys(__root, { sets: {}, vars: {} });
var __setKeys = Object.keys(__keys.sets);
var __varKeys = Object.keys(__keys.vars);
await Promise.all(
  __setKeys.map(function (k) { return importSetByKey(k).then(function (r) { setCache[k] = r; }); })
  .concat(__varKeys.map(function (k) {
    return withTimeout(figma.variables.importVariableByKeyAsync(k).catch(function(){ return null; }), IMPORT_TIMEOUT_MS)
      .then(function (v) { varCache[k] = v || null; });
  }))
);

var pageRoot = figma.createFrame();
pageRoot.name = "Arcade Export — " + __PLAN__.frame.slug;
pageRoot.fills = [];
pageRoot.layoutMode = "NONE";
pageRoot.clipsContent = false;
figma.currentPage.appendChild(pageRoot);
var rOx = __root.box.x, rOy = __root.box.y;
var bounds = planBounds(__root, rOx, rOy, { w: 1, h: 1 });
try { pageRoot.resizeWithoutConstraints(Math.max(bounds.w, 1), Math.max(bounds.h, 1)); } catch (e) {}
if (__root.kind === "frame" && !__root.layout) {
  if (__root.fillVariableKey) { await bindFill(pageRoot, __root.fillVariableKey); } else if (__root.fillColor) { setSolid(pageRoot, __root.fillColor); }
  applyCorners(pageRoot, __root);
  applyBorders(pageRoot, __root.borders);
  made.frames++; // pageRoot merged with __root
  for (var i = 0; i < __root.children.length; i++) { await build(__root.children[i], pageRoot, rOx, rOy); }
} else {
  await build(__root, pageRoot, rOx, rOy);
}
pageRoot.x = 0; pageRoot.y = 0;
figma.currentPage.selection = [pageRoot];
figma.viewport.scrollAndZoomIntoView([pageRoot]);
return { made: made, errs: errs, rootId: pageRoot.id };
`;

export function buildExecuteScript(slj: SljDocument, maps: ExecutePlanMaps): string {
  const plan = sljToExecutePlan(slj, maps);
  return `var __PLAN__ = ${JSON.stringify(plan)};\n${RUNTIME}`;
}
