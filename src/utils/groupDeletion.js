import {
  arrayRemove,
  collection,
  doc,
  getDocsFromServer,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';

const MAX_ATOMIC_BATCH_OPERATIONS = 500;
const SAFE_BATCH_CHUNK_SIZE = 450;
const MAX_RECONCILIATION_PASSES = 5;

async function readCleanupOperations(db, groupId) {
  const [classes, students, payments] = await Promise.all([
    getDocsFromServer(collection(db, `groups/${groupId}/pastClasses`)),
    getDocsFromServer(query(collection(db, 'students'), where('groups', 'array-contains', groupId))),
    getDocsFromServer(query(collection(db, 'payments'), where('groups', 'array-contains', groupId))),
  ]);
  const operations = [];
  classes.forEach(item => operations.push(batch => batch.delete(item.ref)));
  students.forEach(item => operations.push(batch => batch.update(item.ref, { groups: arrayRemove(groupId) })));
  payments.forEach(item => operations.push(batch => batch.update(item.ref, { groups: arrayRemove(groupId) })));
  return operations;
}

async function commitChunks(db, operations, onCommitted) {
  for (let index = 0; index < operations.length; index += SAFE_BATCH_CHUNK_SIZE) {
    const chunk = operations.slice(index, index + SAFE_BATCH_CHUNK_SIZE);
    const batch = writeBatch(db);
    chunk.forEach(apply => apply(batch));
    await batch.commit();
    onCommitted(chunk.length);
  }
}

export async function deleteGroupAndReferences(db, groupId) {
  const groupRef = doc(db, 'groups', groupId);
  const initial = await readCleanupOperations(db, groupId);
  if (initial.length + 1 <= MAX_ATOMIC_BATCH_OPERATIONS) {
    const batch = writeBatch(db);
    initial.forEach(apply => apply(batch));
    batch.delete(groupRef);
    await batch.commit();
    return;
  }

  let committed = 0;
  const record = count => { committed += count; };
  try {
    await commitChunks(db, initial, record);
    for (let pass = 0; pass < MAX_RECONCILIATION_PASSES; pass += 1) {
      const remaining = await readCleanupOperations(db, groupId);
      if (remaining.length + 1 <= MAX_ATOMIC_BATCH_OPERATIONS) {
        const batch = writeBatch(db);
        remaining.forEach(apply => apply(batch));
        batch.delete(groupRef);
        await batch.commit();
        return;
      }
      await commitChunks(db, remaining, record);
    }
    throw new Error('The group kept receiving new references while deletion was running.');
  } catch (error) {
    const deletionError = new Error(error?.message || String(error));
    deletionError.cause = error;
    deletionError.partialCleanupCommitted = committed > 0;
    deletionError.committedCleanupOperations = committed;
    throw deletionError;
  }
}
