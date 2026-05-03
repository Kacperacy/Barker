export class MemoryCache<T> {
  private store = new Map<string, { data: T; expiry: number }>();
  private ttl: number;

  constructor(ttlMilliseconds: number) {
    this.ttl = ttlMilliseconds;
  }

  get(key: string): T | null {
    const item = this.store.get(key);
    if (!item) return null;

    if (Date.now() > item.expiry) {
      this.store.delete(key);
      return null;
    }

    return item.data;
  }

  set(key: string, data: T): void {
    this.store.set(key, { data, expiry: Date.now() + this.ttl });
  }
}
