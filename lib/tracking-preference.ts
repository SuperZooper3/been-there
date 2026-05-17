import { getOfflineStorageItem, setOfflineStorageItem } from "@/lib/offline-storage";

const OPT_OUT_KEY = "bt_tracking_user_disabled";

export async function isTrackingOptedOut(): Promise<boolean> {
  const v = await getOfflineStorageItem(OPT_OUT_KEY);
  return v === "1";
}

export async function setTrackingOptedOut(optedOut: boolean): Promise<void> {
  if (optedOut) {
    await setOfflineStorageItem(OPT_OUT_KEY, "1");
  } else {
    await setOfflineStorageItem(OPT_OUT_KEY, "0");
  }
}
