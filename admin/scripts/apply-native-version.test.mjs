import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyAndroidGradle,
  applyInfoPlist,
  applyPbxproj,
  applyStringsXml,
  marketingVersion,
  nextVersionCode,
} from "./apply-native-version.mjs";

describe("native version from package.json", () => {
  it("bumps versionCode when versionName changes to 1.1.0, then stays put", () => {
    const source = `
      defaultConfig {
          applicationId "com.nova.admin"
          minSdkVersion rootProject.ext.minSdkVersion
          targetSdkVersion rootProject.ext.targetSdkVersion
          versionCode 1
          versionName "1.0"
      }
    `;
    const first = applyAndroidGradle(source, "1.1.0");
    assert.equal(first.versionName, "1.1.0");
    assert.equal(first.versionCode, 2);
    assert.match(first.text, /versionCode 2/);
    assert.match(first.text, /versionName "1\.1\.0"/);
    const second = applyAndroidGradle(first.text, "1.1.0");
    assert.equal(second.versionCode, 2);
  });

  it("writes the iOS marketing version and build number", () => {
    const pbx = applyPbxproj(
      "MARKETING_VERSION = 1.0;\nCURRENT_PROJECT_VERSION = 1;\n",
      "1.1.0",
      2,
    );
    assert.match(pbx.text, /MARKETING_VERSION = 1\.1\.0;/);
    assert.match(pbx.text, /CURRENT_PROJECT_VERSION = 2;/);
    const plist = applyInfoPlist(
      "<dict>\n  <key>CFBundleShortVersionString</key>\n  <string>1.0</string>\n  <key>CFBundleVersion</key>\n  <string>1</string>\n</dict>\n",
      "1.1.0",
      2,
    );
    assert.match(plist.text, /<key>CFBundleShortVersionString<\/key>\s*<string>1\.1\.0<\/string>/);
    assert.match(plist.text, /<key>CFBundleVersion<\/key>\s*<string>2<\/string>/);
    assert.match(plist.text, /<key>CFBundleDisplayName<\/key>\s*<string>VEXO 管理端<\/string>/);
  });

  it("sets the Android display name", () => {
    const xml = applyStringsXml(
      '<resources>\n  <string name="app_name">NOVA 管理端</string>\n  <string name="title_activity_main">NOVA 管理端</string>\n</resources>\n',
    );
    assert.match(xml, /<string name="app_name">VEXO 管理端<\/string>/);
    assert.match(xml, /<string name="title_activity_main">VEXO 管理端<\/string>/);
    assert.equal(marketingVersion("1.1.0-beta"), "1.1.0");
    assert.equal(nextVersionCode(4, "1.1.0", "1.1.0"), 4);
  });
});
