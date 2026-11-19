/** Lista de ediciones de un chunk: pares [índice local, id de bloque]. */
export type EditList = Array<[number, number]>;

const STORE = 'chunks';
/** Capa de agua por chunk (se añadió en la versión 2 de la base de datos). */
const LIQUID_STORE = 'liquid';
const DB_VERSION = 2;

export class ChunkStore {
  private readonly db: IDBDatabase;

  private constructor(db: IDBDatabase) {
    this.db = db;
  }

  static open(seed: number): Promise<ChunkStore> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(`terraria-pixi-${seed}`, DB_VERSION);
      // Se ejecuta al crear la base de datos o al subir de versión: los guardados de la versión 1
      // conservan sus ediciones y solo ganan el almacén nuevo.
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        if (!db.objectStoreNames.contains(LIQUID_STORE)) db.createObjectStore(LIQUID_STORE);
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

  /** Capas de agua guardadas: clave "cx,cy" -> nivel por celda. */
  loadAllLiquid(): Promise<Map<string, Uint16Array>> {
    return new Promise((resolve, reject) => {
      const result = new Map<string, Uint16Array>();
      const store = this.db.transaction(LIQUID_STORE, 'readonly').objectStore(LIQUID_STORE);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const value = cursor.value as unknown;
          if (value instanceof Uint16Array) result.set(String(cursor.key), value);
          cursor.continue();
        } else {
          resolve(result);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  saveManyLiquid(entries: Array<[string, Uint16Array]>): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(LIQUID_STORE, 'readwrite');
      const store = tx.objectStore(LIQUID_STORE);
      for (const [key, layer] of entries) store.put(layer, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  /** Borra las ediciones y el agua guardadas. */
  clear(): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction([STORE, LIQUID_STORE], 'readwrite');
      tx.objectStore(STORE).clear();
      tx.objectStore(LIQUID_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}