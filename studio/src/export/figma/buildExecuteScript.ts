// studio/src/export/figma/buildExecuteScript.ts
import type { SljDocument } from "../slj";
import { sljToExecutePlan, type ExecutePlanMaps } from "./executePlan";

/** Fixed runtime that runs in the Figma plugin sandbox. Reads global __PLAN__,
 *  builds frames (auto-layout) + real component instances (local-node resolve,
 *  variant, label, icon swap, token fill). Best-effort per node. Returns a
 *  summary. Plain ES5-ish JS — no optional chaining, no nullish coalescing, no TS. */
const RUNTIME = `
var made = { frames: 0, instances: 0, icons: 0, binds: 0, fail: 0 };
var errs = [];
var setCache = {};
var fonts = {};
var varCache = {};

async function getLocalSet(key, setName) {
  if (setCache[key] !== undefined) return setCache[key];
  var found = null;
  try { found = await figma.importComponentSetByKeyAsync(key); } catch (e) { found = null; }
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
  if (fonts[k]) return true;
  try { await figma.loadFontAsync(fn); fonts[k] = true; return true; } catch (e) { return false; }
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
  if (v === undefined) { try { v = await figma.variables.importVariableByKeyAsync(varKey); } catch (e) { v = null; } varCache[varKey] = v; }
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
    try { if (node.box.width > 0 && node.box.height > 0) inst.resize(node.box.width, node.box.height); } catch (e) {}
    inst.x = node.box.x - ox; inst.y = node.box.y - oy;
    if (node.text) await setLabel(inst, node.text.propName ? node.text.propName : null, node.text.characters);
    if (node.iconSetKey) { await setIcon(inst, node.iconSetKey, node.iconSetName ? node.iconSetName : ""); made.icons++; }
    made.instances++;
    return;
  }
  if (node.kind === "text") {
    var t = figma.createText();
    parent.appendChild(t);
    var okFont = await ensureFont({ family: "Inter", style: "Regular" });
    if (okFont) { try { t.fontName = { family: "Inter", style: "Regular" }; } catch (e) {} }
    try { t.characters = node.characters; } catch (e) {}
    t.x = node.box.x - ox; t.y = node.box.y - oy;
    if (node.fillVariableKey) { await bindFill(t, node.fillVariableKey); } else if (node.fillColor) { setSolid(t, node.fillColor); }
    return;
  }
  var f = figma.createFrame();
  f.name = "frame";
  f.fills = [];
  f.clipsContent = false;
  applyLayout(f, node.layout);
  parent.appendChild(f);
  try { f.resizeWithoutConstraints(Math.max(node.box.width, 1), Math.max(node.box.height, 1)); } catch (e) {}
  f.x = node.box.x - ox; f.y = node.box.y - oy;
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
