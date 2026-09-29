// Minimal LRU cache: Map keeps insertion order, so re-inserting on access moves a key to the end.
export class Lru<V> {
  private readonly entries = new Map<string, V>();
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxSize) {
      this.entries.delete(this.entries.keys().next().value!);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
