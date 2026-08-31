import { collection, getDocsFromServer } from 'firebase/firestore';

const emptyHistoryCache = () => ({ payments: [], loadedAt: null });
const historyCaches = new Map();
const historyRequests = new Map();
let cacheGeneration = 0;

export function getProjectPaymentHistoryCache(scopeKey) {
  return historyCaches.get(scopeKey) || emptyHistoryCache();
}

export function hasFreshProjectPaymentHistory(scopeKey, projects, cacheTtlMs) {
  const cache = getProjectPaymentHistoryCache(scopeKey);
  const projectIdsKey = (Array.isArray(projects) ? projects : [])
    .map(project => project?.id).filter(Boolean).sort().join(',');
  return Number.isFinite(Number(cache.loadedAt))
    && cache.projectIdsKey === projectIdsKey
    && Date.now() - Number(cache.loadedAt) < cacheTtlMs;
}

export function loadProjectPaymentHistory(db, projects, scopeKey) {
  const projectIds = (Array.isArray(projects) ? projects : [])
    .map(project => project?.id)
    .filter(Boolean);
  const requestKey = `${scopeKey}:${projectIds.slice().sort().join(',')}`;
  const existingRequest = historyRequests.get(requestKey);
  if (existingRequest) return existingRequest;

  const requestGeneration = cacheGeneration;
  const request = Promise.all(projectIds.map(async projectId => {
    const snapshot = await getDocsFromServer(collection(db, `projects/${projectId}/payments`));
    return snapshot.docs.map(item => ({
      id: item.id,
      ...item.data(),
      projectId,
      paymentKind: 'project',
    }));
  }))
    .then(projectPayments => {
      const nextCache = {
        payments: projectPayments.flat(),
        projectIdsKey: projectIds.slice().sort().join(','),
        loadedAt: Date.now(),
      };
      if (cacheGeneration === requestGeneration) historyCaches.set(scopeKey, nextCache);
      return nextCache;
    })
    .finally(() => historyRequests.delete(requestKey));

  historyRequests.set(requestKey, request);
  return request;
}

export function invalidateProjectPaymentHistory() {
  cacheGeneration += 1;
  historyRequests.clear();
  for (const [scopeKey, cache] of historyCaches) {
    historyCaches.set(scopeKey, { ...cache, loadedAt: null });
  }
}
