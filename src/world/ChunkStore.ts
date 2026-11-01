/** Lista de ediciones de un chunk: pares [índice local, id de bloque]. */
export type EditList = Array<[number, number]>;

const STORE = 'chunks';

export class ChunkStore {
  private readonly db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.db = db;
  }

  static open(seed: number): Promise<ChunkStore> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(`terraria-pixi-${seed}`, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(new ChunkStore(req.result));
      req.onerror = () => reject(req.error);
    });
  }

  loadAll(): Promise<Map<string, EditList>> {
    return new Promise((resolve, reject) => {
      const result = new Map<string, EditList>();
      const store = this.db.transaction(STORE, 'readonly').objectStore(STORE);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          result.set(String(cursor.key), cursor.value as EditList);
          cursor.continue();
        } else {
          resolve(result);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  saveMany(entries: Array<[string, EditList]>): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const [key, list] of entries) store.put(list, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  clear(): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}