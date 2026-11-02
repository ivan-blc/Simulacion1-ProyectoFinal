/** Reutiliza objetos caros de crear (texturas) en lugar de crearlos y destruirlos continuamente. */
export class ObjectPool<T> {
  created = 0;
  reused = 0;
  destroyed = 0;

  private readonly idle: T[] = [];
  private readonly create: () => T;
  private readonly destroyItem: (item: T) => void;
  private readonly maxIdle: number;

  constructor(create: () => T, destroyItem: (item: T) => void, maxIdle: number) {
    this.create = create;
    this.destroyItem = destroyItem;
    this.maxIdle = maxIdle;
  }

  get idleCount(): number {
    return this.idle.length;
  }

  acquire(): T {
    const item = this.idle.pop();
    if (item !== undefined) {
      this.reused++;
      return item;
    }
    this.created++;
    return this.create();
  }

  /** Devuelve el objeto al pool; si ya hay demasiados inactivos, lo destruye. */
  release(item: T): void {
    if (this.idle.length < this.maxIdle) {
      this.idle.push(item);
    } else {
      this.destroyItem(item);
      this.destroyed++;
    }
  }

  clear(): void {
    for (const item of this.idle) {
      this.destroyItem(item);
      this.destroyed++;
    }
    this.idle.length = 0;
  }
}