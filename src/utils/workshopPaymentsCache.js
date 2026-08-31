import { collection, getDocsFromServer } from 'firebase/firestore';
let cache = { payments: [], loadedAt: null, idsKey: '' };
let request = null;

export function getWorkshopPaymentHistoryCache() { return cache; }
export function hasFreshWorkshopPaymentHistory(workshops, ttl) {
  const idsKey = (workshops || []).map(item => item.id).filter(Boolean).sort().join(',');
  return cache.idsKey === idsKey && cache.loadedAt !== null && Date.now() - cache.loadedAt < ttl;
}
export function loadWorkshopPaymentHistory(db, workshops) {
  if (request) return request;
  const ids = (workshops || []).map(item => item.id).filter(Boolean);
  request = Promise.all(ids.map(async workshopId => {
    const snapshot = await getDocsFromServer(collection(db, `workshops/${workshopId}/payments`));
    return snapshot.docs.map(item => ({ id: item.id, ...item.data(), workshopId, paymentKind: 'workshop' }));
  })).then(rows => {
    cache = { payments: rows.flat(), loadedAt: Date.now(), idsKey: ids.slice().sort().join(',') };
    return cache;
  }).finally(() => { request = null; });
  return request;
}
export function invalidateWorkshopPaymentHistory() { cache = { ...cache, loadedAt: null }; }
