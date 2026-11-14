/**
 * VEXO storage keys and the one-shot migration off the old NOVA keys.
 *
 * The migration flag is set only after the copy. A later launch sees the flag
 * and does not read the old keys again, so a logout that cleared the new token
 * cannot be undone by an old value being copied back.
 */

export const MIGRATION_FLAG = "vexo-admin-storage-migrated";

export const STORE_KEY = "vexo-admin-v2";
export const OLD_STORE_KEY = "nova-admin-v2";
export const CONFIG_KEY = "vexo-admin-api-config-v1";
export const OLD_CONFIG_KEY = "nova-admin-api-config-v1";
export const THEME_STORAGE_KEY = "vexo-admin-theme";
export const OLD_THEME_STORAGE_KEY = "nova-admin-theme";
export const SKIN_STORAGE_KEY = "vexo-admin-skin";
export const OLD_SKIN_STORAGE_KEY = "nova-admin-skin";
export const SESSION_KEY = "vexo-admin-session";
export const OLD_SESSION_KEY = "nova-admin-session";
export const BUGSINK_KEY = "vexo-admin-bugsink";
export const OLD_BUGSINK_KEY = "nova-admin-bugsink";
export const BUGSINK_DSN_KEY = "vexo-admin-bugsink-dsn";
export const OLD_BUGSINK_DSN_KEY = "nova-admin-bugsink-dsn";

/** Better Auth preview bearer. Still used by src/lib/auth/client.ts. */
export const PREVIEW_BEARER_KEY = "grok-auth.bearer-token";

export const LOCAL_MIGRATIONS: ReadonlyArray<readonly [string, string]> = [
  [OLD_STORE_KEY, STORE_KEY],
  [OLD_CONFIG_KEY, CONFIG_KEY],
  [OLD_THEME_STORAGE_KEY, THEME_STORAGE_KEY],
  [OLD_SKIN_STORAGE_KEY, SKIN_STORAGE_KEY],
  [OLD_BUGSINK_KEY, BUGSINK_KEY],
  [OLD_BUGSINK_DSN_KEY, BUGSINK_DSN_KEY],
];

export const SESSION_MIGRATIONS: ReadonlyArray<readonly [string, string]> = [[OLD_SESSION_KEY, SESSION_KEY]];

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function copyOnce(storage: StorageLike, oldKey: string, newKey: string) {
  const oldVal = storage.getItem(oldKey);
  const newVal = storage.getItem(newKey);
  // An empty old value is a cleared token/blob. Copying it would wipe the new key.
  if (oldVal != null && oldVal !== "" && (newVal == null || newVal === "")) {
    storage.setItem(newKey, oldVal);
  }
  if (oldVal != null) storage.removeItem(oldKey);
}

/** Runs at most once. A second call is a no-op even if old keys reappear. */
export function migrateAdminStorage(local: StorageLike, session: StorageLike = local): { migrated: boolean } {
  if (local.getItem(MIGRATION_FLAG) === "1") return { migrated: false };
  for (const [oldKey, newKey] of LOCAL_MIGRATIONS) copyOnce(local, oldKey, newKey);
  for (const [oldKey, newKey] of SESSION_MIGRATIONS) copyOnce(session, oldKey, newKey);
  local.setItem(MIGRATION_FLAG, "1");
  return { migrated: true };
}

function clearTokenField(storage: StorageLike, key: string) {
  const raw = storage.getItem(key);
  if (raw == null) return;
  try {
    const data = JSON.parse(raw) as { token?: unknown };
    if (data && typeof data === "object" && !Array.isArray(data)) {
      data.token = "";
      storage.setItem(key, JSON.stringify(data));
      return;
    }
  } catch {
    /* not JSON — drop the whole entry */
  }
  storage.removeItem(key);
}

/** Logout clears the admin token under both the old and new keys, plus the preview bearer. */
export function clearAuthStorage(local: StorageLike, session: StorageLike = local) {
  clearTokenField(local, OLD_CONFIG_KEY);
  clearTokenField(local, CONFIG_KEY);
  session.removeItem(OLD_SESSION_KEY);
  session.removeItem(SESSION_KEY);
  session.removeItem(PREVIEW_BEARER_KEY);
  local.removeItem(PREVIEW_BEARER_KEY);
}
