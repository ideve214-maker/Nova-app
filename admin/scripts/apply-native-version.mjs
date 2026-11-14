/**
 * Write package.json version into the Capacitor Android and iOS projects.
 * versionName / MARKETING_VERSION / CFBundleShortVersionString = x.y.z
 * versionCode / CURRENT_PROJECT_VERSION / CFBundleVersion bumps when the
 * marketing version changes, and stays put when the build is run again.
 *
 * Missing native projects are skipped (exit 0) so a web-only build still works.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const APP_DISPLAY_NAME = "VEXO 管理端";

export function marketingVersion(version) {
  const match = String(version || "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : "1.1.0";
}

/** When versionName changes, versionCode becomes previous + 1 (at least 2). */
export function nextVersionCode(existingCode, existingName, nextName) {
  const current = Number.parseInt(String(existingCode ?? ""), 10);
  const base = Number.isFinite(current) && current > 0 ? current : 1;
  if (existingName === nextName) return base;
  return base + 1;
}

export function applyAndroidGradle(source, pkgVersion) {
  const versionName = marketingVersion(pkgVersion);
  const nameMatch = source.match(/versionName\s+["']([^"']+)["']/);
  const codeMatch = source.match(/versionCode\s+(\d+)/);
  const versionCode = nextVersionCode(codeMatch?.[1], nameMatch?.[1] ?? "", versionName);
  let text = source;
  if (codeMatch) text = text.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
  else text = text.replace(/defaultConfig\s*\{/, `defaultConfig {\n        versionCode ${versionCode}`);
  if (nameMatch) text = text.replace(/versionName\s+["'][^"']+["']/, `versionName "${versionName}"`);
  else text = text.replace(/versionCode\s+\d+/, (line) => `${line}\n        versionName "${versionName}"`);
  return { text, versionCode, versionName };
}

export function applyPbxproj(source, pkgVersion, versionCode) {
  const versionName = marketingVersion(pkgVersion);
  let text = source;
  if (/MARKETING_VERSION\s*=/.test(text)) {
    text = text.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${versionName};`);
  }
  if (/CURRENT_PROJECT_VERSION\s*=/.test(text)) {
    text = text.replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${versionCode};`);
  }
  return { text, versionName, versionCode };
}

export function applyInfoPlist(source, pkgVersion, versionCode) {
  const versionName = marketingVersion(pkgVersion);
  const build = String(versionCode);
  let text = source;
  text = replacePlistString(text, "CFBundleShortVersionString", versionName);
  text = replacePlistString(text, "CFBundleVersion", build);
  text = replacePlistString(text, "CFBundleDisplayName", APP_DISPLAY_NAME);
  return { text, versionName, versionCode };
}

function replacePlistString(source, key, value) {
  const pattern = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
  if (pattern.test(source)) return source.replace(pattern, `$1${value}$2`);
  return source.replace(
    "</dict>",
    `  <key>${key}</key>\n  <string>${value}</string>\n</dict>`,
  );
}

export function applyStringsXml(source, displayName = APP_DISPLAY_NAME) {
  let text = source;
  for (const name of ["app_name", "title_activity_main", "package_name", "custom_url_scheme"]) {
    if (name === "package_name" || name === "custom_url_scheme") continue;
    const pattern = new RegExp(`(<string name="${name}">)[^<]*(</string>)`);
    if (pattern.test(text)) text = text.replace(pattern, `$1${displayName}$2`);
  }
  return text;
}

export function readPackageVersion(root) {
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  return String(pkg.version || "1.1.0");
}

export function applyNativeVersion(root) {
  const pkgVersion = readPackageVersion(root);
  const versionName = marketingVersion(pkgVersion);
  const written = [];

  const gradlePath = resolve(root, "android/app/build.gradle");
  let versionCode = nextVersionCode(undefined, "", versionName);
  if (existsSync(gradlePath)) {
    const applied = applyAndroidGradle(readFileSync(gradlePath, "utf8"), pkgVersion);
    versionCode = applied.versionCode;
    writeFileSync(gradlePath, applied.text);
    written.push(gradlePath);
  }

  const stringsPath = resolve(root, "android/app/src/main/res/values/strings.xml");
  if (existsSync(stringsPath)) {
    writeFileSync(stringsPath, applyStringsXml(readFileSync(stringsPath, "utf8")));
    written.push(stringsPath);
  }

  const pbxPath = resolve(root, "ios/App/App.xcodeproj/project.pbxproj");
  if (existsSync(pbxPath)) {
    const applied = applyPbxproj(readFileSync(pbxPath, "utf8"), pkgVersion, versionCode);
    writeFileSync(pbxPath, applied.text);
    written.push(pbxPath);
  }

  const plistPath = resolve(root, "ios/App/App/Info.plist");
  if (existsSync(plistPath)) {
    const applied = applyInfoPlist(readFileSync(plistPath, "utf8"), pkgVersion, versionCode);
    writeFileSync(plistPath, applied.text);
    written.push(plistPath);
  }

  return { versionName, versionCode, written };
}

const isMain = process.argv[1] && process.argv[1].endsWith("apply-native-version.mjs");
if (isMain) {
  const result = applyNativeVersion(resolve(process.argv[2] || "."));
  console.log(
    `[vexo-admin] native version ${result.versionName} (${result.versionCode}) in ${result.written.length} file(s)`,
  );
}
