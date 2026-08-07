const cacheEpochs = new WeakMap();

export function getReadCacheEpoch(cache) {
  return cacheEpochs.get(cache) || 0;
}

export function markReadCacheChanged(cache) {
  const nextEpoch = getReadCacheEpoch(cache) + 1;
  cacheEpochs.set(cache, nextEpoch);
  return nextEpoch;
}

export function invalidateReadCache(cache) {
  markReadCacheChanged(cache);
  cache.clear();
}
