// Runs the real pre-React boot scripts (spa.html and __root.tsx THEME_BOOT) twice
// against fake storage: the old NOVA keys must be copied on the first launch only,
// and a value cleared by logout must not be copied back on the second launch.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function read(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function memory() {
  const data = new Map();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

function bootScripts() {
  const spa = read("../spa.html");
  const fromSpa = [...spa.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((m) => m[1])
    .find((s) => s.includes("vexo-admin-storage-migrated"));
  const root = read("../src/routes/__root.tsx");
  const fromRoot = root.match(/const THEME_BOOT = `([\s\S]*?)`;/)[1];
  return { spa: fromSpa, root: fromRoot };
}

function run(code, local, session) {
  const el = { setAttribute() {}, style: {} };
  const ctx = {
    localStorage: local,
    sessionStorage: session,
    window: { matchMedia: () => ({ matches: false }) },
    document: { documentElement: el, querySelector: () => null },
  };
  vm.runInNewContext(code, ctx);
}

for (const [name, code] of Object.entries(bootScripts())) {
  describe(`${name} boot migration`, () => {
    it("is present", () => assert.ok(code, `${name} boot script with the migration flag not found`));

    it("copies old keys once and never re-copies after logout cleared them", () => {
      const local = memory();
      const session = memory();
      local.setItem("nova-admin-api-config-v1", JSON.stringify({ token: "old-token", baseUrl: "http://x" }));
      session.setItem("nova-admin-session", "1");

      run(code, local, session); // first launch
      assert.equal(JSON.parse(local.getItem("vexo-admin-api-config-v1")).token, "old-token");
      assert.equal(local.getItem("nova-admin-api-config-v1"), null);
      assert.equal(session.getItem("vexo-admin-session"), "1");
      assert.equal(local.getItem("vexo-admin-storage-migrated"), "1");

      // logout clears the new token and session
      local.setItem("vexo-admin-api-config-v1", JSON.stringify({ token: "", baseUrl: "http://x" }));
      session.removeItem("vexo-admin-session");
      // an old value reappears (e.g. stale write from an old bundle)
      local.setItem("nova-admin-api-config-v1", JSON.stringify({ token: "old-token", baseUrl: "http://x" }));
      session.setItem("nova-admin-session", "1");

      run(code, local, session); // second launch
      assert.equal(JSON.parse(local.getItem("vexo-admin-api-config-v1")).token, "");
      assert.equal(session.getItem("vexo-admin-session"), null);
    });
  });
}
