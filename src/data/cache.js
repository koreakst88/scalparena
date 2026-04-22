// src/data/cache.js

class Cache {
  constructor() {
    this.store = new Map();
  }

  get(key) {
    return this.store.get(key);
  }

  set(key, value) {
    this.store.set(key, value);
  }

  has(key) {
    return this.store.has(key);
  }

  delete(key) {
    return this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }
}

module.exports = Cache;

