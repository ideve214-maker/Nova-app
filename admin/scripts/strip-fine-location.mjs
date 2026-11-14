/**
 * Drop ACCESS_FINE_LOCATION from Android manifests.
 * ACCESS_COARSE_LOCATION is kept. If a manifest had only fine, it is replaced
 * with coarse so location still works without high accuracy.
 *
 * The app manifest (android/app/src/main/AndroidManifest.xml) also gets
 * <uses-permission android:name="...ACCESS_FINE_LOCATION" tools:node="remove" />
 * so a plugin that declares fine location cannot bring it back through the
 * Gradle manifest merge.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const FINE = "android.permission.ACCESS_FINE_LOCATION";
const COARSE = "android.permission.ACCESS_COARSE_LOCATION";

const REMOVE_LINE = `<uses-permission android:name="${FINE}" tools:node="remove" />`;
const TOOLS_NS = 'xmlns:tools="http://schemas.android.com/tools"';

function isRemoveMarker(tag) {
  return /tools:node="remove"/.test(tag);
}

export function stripFineLocation(xml) {
  const hadFine = (xml.match(/<uses-permission\b[^>]*ACCESS_FINE_LOCATION[^>]*>/g) || []).some((t) => !isRemoveMarker(t));
  const hadCoarse = xml.includes(COARSE);
  let next = xml.replace(
    /[ \t]*<uses-permission\b[^>]*android:name="android\.permission\.ACCESS_FINE_LOCATION"[^>]*\/>\s*\n?/g,
    (m) => (isRemoveMarker(m) ? m : ""),
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

/** Block fine location from merged library manifests (app manifest only). */
export function addFineLocationRemoveMarker(xml) {
  let next = xml;
  if (!/<manifest\b[^>]*xmlns:tools=/.test(next)) {
    next = next.replace(/<manifest\b/, `<manifest ${TOOLS_NS}`);
  }
  if (!/ACCESS_FINE_LOCATION"[^>]*tools:node="remove"/.test(next)) {
    next = next.replace(/(<manifest\b[^>]*>)/, `$1\n    ${REMOVE_LINE}`);
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
    let next = stripFineLocation(source);
    if (file.endsWith(join("app", "src", "main", "AndroidManifest.xml"))) next = addFineLocationRemoveMarker(next);
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
  console.log(`[vexo-admin] removed/blocked ACCESS_FINE_LOCATION in ${changed.length} manifest(s)`);
}
