#!/usr/bin/env node
// Recompute latest-mac.yml's sha512 + size for a (re-zipped, stapled) artifact.
// electron-updater verifies the downloaded zip against the manifest's sha512;
// re-zipping the stapled .app changes the bytes, so the manifest MUST be
// rewritten to match or the update is rejected.
//
// Usage: node rewrite-latest-mac.mjs <zipPath> <ymlPath> <version>
import fs from "node:fs";
import crypto from "node:crypto";

const [, , zipPath, ymlPath, version] = process.argv;
if (!zipPath || !ymlPath || !version) {
  console.error("usage: rewrite-latest-mac.mjs <zipPath> <ymlPath> <version>");
  process.exit(1);
}

const bytes = fs.readFileSync(zipPath);
const sha512 = crypto.createHash("sha512").update(bytes).digest("base64");
const size = bytes.length;
// electron-builder / electron-updater use the SPACE→DASH "safe" artifact name
// in the manifest url; the file uploaded to the release MUST match it byte-for-
// byte or the update download 404s. release.sh renames the file to this safe
// name before uploading.
const zipName = (zipPath.split("/").pop() ?? "").replace(/ /g, "-");

const yml = `version: ${version}
files:
  - url: ${zipName}
    sha512: ${sha512}
    size: ${size}
path: ${zipName}
sha512: ${sha512}
releaseDate: '${new Date().toISOString()}'
`;
fs.writeFileSync(ymlPath, yml);
console.log(`[rewrite-latest-mac] ${zipName} sha512=${sha512.slice(0, 12)}… size=${size}`);
