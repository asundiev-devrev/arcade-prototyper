#!/usr/bin/env node
// PreToolUse hook: deny Bash commands that reshape reference images.
//
// The generator occasionally decides that its pasted screenshot is "too
// small" or "too zoomed", and starts cropping/resampling it with `sips`
// (or ImageMagick / Pillow) into sub-images, then reading each sub-image
// back. Each pass adds zero information — the bytes were already in the
// model's context — and each pass costs a full Bedrock round-trip. A
// handful of passes burn the turn budget before any JSX gets written.
//
// The prompt can't prevent it reliably (we've tried), so we enforce it
// structurally: images are input, not clay. The agent still gets the
// feedback it needs to course-correct — claude-code feeds exit-2 stderr
// back into the turn as a tool_result so the next assistant step sees
// the refusal reason.
//
// Fail-open on any parse/runtime error: a broken hook must not wedge a
// real generation. If we can't decide, allow.
import process from "node:process";

const DENY_MESSAGE =
  "Blocked by studio: do not reshape or slice reference images. " +
  "The attached screenshot is already in your context at the resolution the user sent. " +
  "Reading cropped copies adds no information and burns the turn budget. " +
  "Look at the original and write the frame — leave a {/* TODO: <region> unclear */} if a detail is illegible.";

// Image-tooling binaries that (a) exist on macOS by default or are common
// to have installed, and (b) transform an image when invoked. Listed as
// basenames — we match them after stripping any path prefix.
const TRANSFORM_BINARIES = new Set([
  "magick", "convert", "mogrify", "composite",
  "gm", // GraphicsMagick
  "pngcrush", "pngquant", "optipng", "jpegoptim",
  "cwebp", "dwebp", "heif-convert",
  "ffmpeg",
]);

// sips has both metadata reads (-g/--getProperty) and transforms
// (-z/-Z/-c/-s/--resample*/--crop*/--pad*/--rotate/--flip). Allow the
// metadata form; deny everything else.
const SIPS_METADATA_FLAGS = new Set([
  "-g", "--getProperty",
  "-h", "--help",
  "-X", "--extractProfile",
]);

function isSipsTransform(argv) {
  // argv[0] is "sips", rest are flags + paths.
  // If every flag we see is a metadata flag, it's a read.
  for (let i = 1; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith("-")) continue;
    if (!SIPS_METADATA_FLAGS.has(tok)) return true;
  }
  return false;
}

// Python inline scripts (-c "…") that import PIL / cv2 are image
// manipulation in disguise. If the command is python with a -c script,
// scan the script body.
function isPythonImageScript(argv) {
  if (argv.length < 3) return false;
  const bin = basename(argv[0]);
  if (!/^python(3(\.\d+)?)?$/.test(bin)) return false;
  // Look for `-c <script>`
  for (let i = 1; i < argv.length - 1; i++) {
    if (argv[i] === "-c") {
      const body = argv[i + 1] ?? "";
      return /\b(PIL|Pillow|cv2|imageio|wand|skimage)\b/.test(body);
    }
  }
  return false;
}

function basename(p) {
  const idx = p.lastIndexOf("/");
  return idx === -1 ? p : p.slice(idx + 1);
}

// Split a shell command into segments separated by `&&`, `||`, `;`, `|`.
// This is a lightweight tokenizer — not a real shell parser — but it
// handles the common `cd "…" && sips …` pattern that claude emits.
function splitSegments(cmd) {
  const segments = [];
  let buf = "";
  let quote = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote) {
      buf += c;
      if (c === quote && cmd[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; buf += c; continue; }
    const two = cmd.slice(i, i + 2);
    if (two === "&&" || two === "||") {
      segments.push(buf.trim()); buf = ""; i += 1; continue;
    }
    if (c === ";" || c === "|") {
      segments.push(buf.trim()); buf = ""; continue;
    }
    buf += c;
  }
  if (buf.trim()) segments.push(buf.trim());
  return segments.filter(Boolean);
}

// Tokenize a single segment into argv, respecting simple quoting.
function tokenize(segment) {
  const argv = [];
  let buf = "";
  let quote = null;
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i];
    if (quote) {
      if (c === quote && segment[i - 1] !== "\\") { quote = null; continue; }
      buf += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (/\s/.test(c)) {
      if (buf) { argv.push(buf); buf = ""; }
      continue;
    }
    buf += c;
  }
  if (buf) argv.push(buf);
  return argv;
}

export function shouldBlock(command) {
  if (typeof command !== "string" || !command.trim()) return false;
  for (const segment of splitSegments(command)) {
    const argv = tokenize(segment);
    if (argv.length === 0) continue;
    const bin = basename(argv[0]);
    if (bin === "sips" && isSipsTransform(argv)) return true;
    if (TRANSFORM_BINARIES.has(bin)) return true;
    if (isPythonImageScript(argv)) return true;
  }
  return false;
}

async function readStdin() {
  let buf = "";
  for await (const chunk of process.stdin) buf += chunk;
  return buf;
}

async function main() {
  let payload;
  try {
    const raw = await readStdin();
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    // Fail open — if we can't parse, don't block.
    process.exit(0);
  }
  const cmd = payload?.tool_input?.command;
  if (shouldBlock(cmd)) {
    process.stderr.write(DENY_MESSAGE);
    process.exit(2);
  }
  process.exit(0);
}

// Allow importing for tests without running main().
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(() => process.exit(0));
}
