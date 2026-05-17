import { Capacitor } from "@capacitor/core";

const MIGRATED_KEY = "bt_offline_storage_migrated";

async function prefersCapacitorStorage(): Promise<boolean> {
  return Capacitor.isNativePlatform();
}

export async function getOfflineStorageItem(key: string): Promise<string | null> {
  if (await prefersCapacitorStorage()) {
    const { Preferences } = await import("@capacitor/preferences");
    const { value } = await Preferences.get({ key });
    return value;
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function setOfflineStorageItem(key: string, value: string): Promise<void> {
  if (await prefersCapacitorStorage()) {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.set({ key, value });
    return;
  }
  try {
    localStorage.setItem(key, value);
  } catch {
    /* quota / private mode */
  }
}

export async function removeOfflineStorageItem(key: string): Promise<void> {
  if (await prefersCapacitorStorage()) {
    const { Preferences } = await import("@capacitor/preferences");
    await Preferences.remove({ key });
    return;
  }
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** One-time: copy legacy localStorage offline keys into Preferences on native. */
export async function migrateLegacyOfflineStorage(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const flag = await getOfflineStorageItem(MIGRATED_KEY);
  if (flag === "1") return;

  const keys = ["bt_offline_paint", "bt_offline_erase", "bt_visit_batches", "bt_visit_open_batch"];
  for (const key of keys) {
    try {
      const legacy = localStorage.getItem(key);
      if (legacy != null) {
        const existing = await getOfflineStorageItem(key);
        if (existing == null) {
          await setOfflineStorageItem(key, legacy);
        }
      }
    } catch {
      /* ignore */
    }
  }
  await setOfflineStorageItem(MIGRATED_KEY, "1");
}
