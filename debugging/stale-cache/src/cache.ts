export interface Clock {
  now(): number
}

export const systemClock: Clock = {
  now: () => Date.now(),
}

interface CacheEntry<V> {
  value: V
  expiresAt: number
}

export interface CacheOptions {
  ttlMs: number
  clock: Clock
}

export class ResourceCache<V> {
  private readonly store = new Map<string, CacheEntry<V>>()
  private readonly ttlMs: number
  private readonly clock: Clock

  constructor(options: CacheOptions) {
    this.ttlMs = options.ttlMs
    this.clock = options.clock
  }

  async getOrLoad(key: string, load: () => Promise<V>): Promise<V> {
    const existing = this.store.get(key)
    if (existing && existing.expiresAt > this.clock.now()) {
      return existing.value
    }

    const value = await load()
    this.store.set(key, { value, expiresAt: this.clock.now() + this.ttlMs })
    return value
  }

  clear(): void {
    this.store.clear()
  }

  size(): number {
    return this.store.size
  }
}

export function cacheKeyForResource(resourceId: string): string {
  return `resource:${resourceId}`
}
