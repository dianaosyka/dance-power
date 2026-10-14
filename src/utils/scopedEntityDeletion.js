import {
  collection,
  doc,
  getDocsFromServer,
  writeBatch,
} from 'firebase/firestore';

const SAFE_BATCH_SIZE = 450;

export async function deleteScopedEntity(db, collectionName, entityId, subcollections) {
  if (!db || !collectionName || !entityId) {
    throw new Error('The item could not be identified for deletion.');
  }

  const snapshots = await Promise.all(
    subcollections.map(name => (
      getDocsFromServer(collection(db, `${collectionName}/${entityId}/${name}`))
    ))
  );
  const childRefs = snapshots.flatMap(snapshot => snapshot.docs.map(item => item.ref));

  for (let index = 0; index < childRefs.length; index += SAFE_BATCH_SIZE) {
    const batch = writeBatch(db);
    childRefs.slice(index, index + SAFE_BATCH_SIZE).forEach(reference => batch.delete(reference));
    await batch.commit();
  }

  const parentBatch = writeBatch(db);
  parentBatch.delete(doc(db, collectionName, entityId));
  await parentBatch.commit();
}

export function deleteProjectAndData(db, projectId) {
  return deleteScopedEntity(db, 'projects', projectId, ['signedStudents', 'payments']);
}

export function deleteWorkshopAndData(db, workshopId) {
  return deleteScopedEntity(db, 'workshops', workshopId, ['signedStudents', 'payments']);
}
