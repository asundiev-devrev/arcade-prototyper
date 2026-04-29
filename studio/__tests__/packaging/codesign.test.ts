import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect } from "vitest";

describe("codesign.sh", () => {
  it("ad-hoc signs a .app bundle end-to-end", { timeout: 60_000 }, () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), "arcade-sign-"));
    try {
      const app = path.join(tmp, "Fake.app");
      const macos = path.join(app, "Contents", "MacOS");
      mkdirSync(macos, { recursive: true });
      const bin = path.join(macos, "Fake");
      writeFileSync(bin, "#!/bin/bash\necho hi\n");
      chmodSync(bin, 0o755);
      writeFileSync(
        path.join(app, "Contents", "Info.plist"),
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Fake</string>
<key>CFBundleIdentifier</key><string>com.devrev.fake</string>
<key>CFBundleExecutable</key><string>Fake</string>
<key>CFBundleVersion</key><string>0.1</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>`,
      );

      const script = path.resolve(__dirname, "..", "..", "packaging", "lib", "codesign.sh");
      execSync(`bash "${script}" "${app}"`, { stdio: "inherit" });
      execSync(`codesign -dv "${app}" 2>&1`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
