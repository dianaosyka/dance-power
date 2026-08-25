import { collection, getDocsFromServer } from 'firebase/firestore';
import { getOtherPaymentsFromMonthDocuments } from './otherPaymentsUtils';

const emptyHistoryCache = () => ({ payments: [], loadedAt: null });
const historyCaches = new Map();
const historyRequests = new Map();
let cacheGeneration = 0;

export function getOtherPaymentHistoryCache(scopeKey) {
  return historyCaches.get(scopeKey) || emptyHistoryCache();
}

export function hasFreshOtherPaymentHistory(scopeKey, cacheTtlMs) {
  const cache = getOtherPaymentHistoryCache(scopeKey);
  return Number.isFinite(Number(cache.loadedAt))
    && Date.now() - Number(cache.loadedAt) < cacheTtlMs;
}

export function loadOtherPaymentHistory(db, scopeKey) {
  const existingRequest = historyRequests.get(scopeKey);
  if (existingRequest) return existingRequest;

  const requestGeneration = cacheGeneration;
  const request = getDocsFromServer(collection(db, 'otherpayments'))
    .then(snapshot => {
      const nextCache = {
        payments: getOtherPaymentsFromMonthDocuments(snapshot.docs),
        loadedAt: Date.now(),
      };
      if (cacheGeneration === requestGeneration) {
        historyCaches.set(scopeKey, nextCache);
      }
      return nextCache;
    })
    .finally(() => {
      if (historyRequests.get(scopeKey) === request) {
        historyRequests.delete(scopeKey);
      }
    });

  historyRequests.set(scopeKey, request);
  return request;
}

export function invalidateOtherPaymentHistory() {
  cacheGeneration += 1;
  historyRequests.clear();
  for (const [scopeKey, cache] of historyCaches) {
    historyCaches.set(scopeKey, { ...cache, loadedAt: null });
  }
}
