import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIG_KEY,
  MIGRATION_FLAG,
  OLD_CONFIG_KEY,
  OLD_SESSION_KEY,
  PREVIEW_BEARER_KEY,
  SESSION_KEY,
  clearAuthStorage,
  migrateAdminStorage,
} from "./storage-keys.ts";

function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
  };
}

describe("migrateAdminStorage", () => {
  it("copies a non-empty old token once, then ignores the old key", () => {
    const local = memory();
    const session = memory();
    local.setItem(OLD_CONFIG_KEY, JSON.stringify({ token: "na_secret", baseUrl: "http://x" }));
    session.setItem(OLD_SESSION_KEY, "1");

    const first = migrateAdminStorage(local, session);
    assert.equal(first.migrated, true);
    assert.equal(JSON.parse(local.getItem(CONFIG_KEY)!).token, "na_secret");
    assert.equal(local.getItem(OLD_CONFIG_KEY), null);
    assert.equal(session.getItem(SESSION_KEY), "1");
    assert.equal(session.getItem(OLD_SESSION_KEY), null);
    assert.equal(local.getItem(MIGRATION_FLAG), "1");

    clearAuthStorage(local, session);
    assert.equal(JSON.parse(local.getItem(CONFIG_KEY)!).token, "");
    assert.equal(session.getItem(PREVIEW_BEARER_KEY), null);

    local.setItem(OLD_CONFIG_KEY, JSON.stringify({ token: "na_secret", baseUrl: "http://x" }));
    session.setItem(OLD_SESSION_KEY, "1");
    const second = migrateAdminStorage(local, session);
    assert.equal(second.migrated, false);
    assert.equal(JSON.parse(local.getItem(CONFIG_KEY)!).token, "");
    assert.equal(session.getItem(SESSION_KEY), null);
  });

  it("does not copy an already-cleared old value over a new value", () => {
    const local = memory();
    local.setItem(OLD_CONFIG_KEY, "");
    local.setItem(CONFIG_KEY, JSON.stringify({ token: "keep-me", baseUrl: "http://x" }));
    migrateAdminStorage(local, memory());
    assert.equal(JSON.parse(local.getItem(CONFIG_KEY)!).token, "keep-me");
    assert.equal(local.getItem(OLD_CONFIG_KEY), null);
  });
});

describe("clearAuthStorage", () => {
  it("clears the token on the old and new keys and the preview bearer", () => {
    const local = memory();
    const session = memory();
    local.setItem(OLD_CONFIG_KEY, JSON.stringify({ token: "old-token", baseUrl: "http://old" }));
    local.setItem(CONFIG_KEY, JSON.stringify({ token: "new-token", baseUrl: "http://new" }));
    session.setItem(OLD_SESSION_KEY, "1");
    session.setItem(SESSION_KEY, "1");
    session.setItem(PREVIEW_BEARER_KEY, "preview-bearer");
    local.setItem(PREVIEW_BEARER_KEY, "preview-bearer");

    clearAuthStorage(local, session);

    assert.equal(JSON.parse(local.getItem(OLD_CONFIG_KEY)!).token, "");
    assert.equal(JSON.parse(local.getItem(OLD_CONFIG_KEY)!).baseUrl, "http://old");
    assert.equal(JSON.parse(local.getItem(CONFIG_KEY)!).token, "");
    assert.equal(JSON.parse(local.getItem(CONFIG_KEY)!).baseUrl, "http://new");
    assert.equal(session.getItem(OLD_SESSION_KEY), null);
    assert.equal(session.getItem(SESSION_KEY), null);
    assert.equal(session.getItem(PREVIEW_BEARER_KEY), null);
    assert.equal(local.getItem(PREVIEW_BEARER_KEY), null);
  });
});
