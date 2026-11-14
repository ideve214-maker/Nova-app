/**
 * Drop ACCESS_FINE_LOCATION from Android manifests.
 * ACCESS_COARSE_LOCATION is kept. If a manifest had only fine, it is replaced
 * with coarse so location still works without high accuracy.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const FINE = "android.permission.ACCESS_FINE_LOCATION";
const COARSE = "android.permission.ACCESS_COARSE_LOCATION";

export function stripFineLocation(xml) {
  const hadFine = xml.includes(FINE);
  const hadCoarse = xml.includes(COARSE);
  let next = xml.replace(
    /[ \t]*<uses-permission\b[^>]*android:name="android\.permission\.ACCESS_FINE_LOCATION"[^>]*\/>\s*\n?/g,
    "",
  );
  next = next.replace(
    /[ \t]*<uses-permission\b[^>]*android:name="android\.permission\.ACCESS_FINE_LOCATION"[^>]*>\s*<\/uses-permission>\s*\n?/g,
    "",
  );
  if (hadFine && !hadCoarse && !next.includes(COARSE)) {
    next = next.replace(
      /<manifest\b([^>]*)>/,
      `<manifest$1>\n    <uses-permission android:name="${COARSE}" />`,
    );
  }
  return next;
}

function walk(dir, out) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name === "build" || name === ".gradle" || name === "node_modules") continue;
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) walk(path, out);
    else if (name === "AndroidManifest.xml") out.push(path);
  }
}

export function stripFineLocationIn(root) {
  const files = [];
  walk(resolve(root, "android"), files);
  const changed = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const next = stripFineLocation(source);
    if (next !== source) {
      writeFileSync(file, next);
      changed.push(file);
    }
  }
  return changed;
}

const isMain = process.argv[1] && process.argv[1].endsWith("strip-fine-location.mjs");
if (isMain) {
  const changed = stripFineLocationIn(resolve(process.argv[2] || "."));
  console.log(`[vexo-admin] removed ACCESS_FINE_LOCATION from ${changed.length} manifest(s)`);
}
