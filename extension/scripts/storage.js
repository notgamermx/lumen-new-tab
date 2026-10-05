let database;
async function openDatabase() {
  if (!database)
    database = new Promise((resolve, reject) => {
      const request = indexedDB.open('lumen-wallpapers', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('files');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        database = undefined;
        reject(request.error);
      };
    });
  return database;
}
export async function mediaStore(action, value) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', action === 'get' ? 'readonly' : 'readwrite');
    const store = tx.objectStore('files');
    const request =
      action === 'put'
        ? store.put(value, 'wallpaper')
        : action === 'delete'
          ? store.delete('wallpaper')
          : store.get('wallpaper');
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error || new Error('Storage transaction was cancelled.'));
    tx.onerror = () => reject(tx.error);
  });
}
