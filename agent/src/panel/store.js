// Bolblar Agent image store (IndexedDB). Every captured image is kept here,
// so downloads, re-downloads and ZIP export work even after Flow reloads.
const BBStore = (() => {
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((ok, no) => {
    const r = indexedDB.open('bolblar', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('images', { keyPath: 'key' });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  }));
  const tx = async (mode, fn) => {
    const d = await db();
    return new Promise((ok, no) => {
      const t = d.transaction('images', mode);
      const req = fn(t.objectStore('images'));
      t.oncomplete = () => ok(req && req.result);
      t.onerror = () => no(t.error);
    });
  };
  return {
    put: (key, blob) => tx('readwrite', (s) => s.put({ key, blob, at: Date.now() })),
    get: async (key) => { const r = await tx('readonly', (s) => s.get(key)); return r ? r.blob : null; },
    del: (key) => tx('readwrite', (s) => s.delete(key)),
    clear: () => tx('readwrite', (s) => s.clear())
  };
})();
