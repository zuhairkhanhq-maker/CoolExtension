export const StorageManager = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (v) => chrome.storage.local.set(v),
  remove: (k) => chrome.storage.local.remove(k),
};
