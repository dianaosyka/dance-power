import {
  mockBatch,
  mockCollection,
  mockDoc,
  mockGetDocsFromServer,
  mockWriteBatch,
} from 'firebase/firestore';
import { deleteProjectAndData, deleteWorkshopAndData } from './scopedEntityDeletion';

jest.mock('firebase/firestore', () => {
  const batch = { delete: jest.fn(), commit: jest.fn().mockResolvedValue(undefined) };
  const getCollection = jest.fn((db, path) => ({ db, path }));
  const getDocument = jest.fn((db, collectionName, id) => ({ db, path: `${collectionName}/${id}` }));
  const getServerDocuments = jest.fn();
  const makeBatch = jest.fn(() => batch);
  return {
    mockBatch: batch,
    mockCollection: getCollection,
    mockDoc: getDocument,
    mockGetDocsFromServer: getServerDocuments,
    mockWriteBatch: makeBatch,
    collection: getCollection,
    doc: getDocument,
    getDocsFromServer: getServerDocuments,
    writeBatch: makeBatch,
  };
});

describe('scoped entity deletion', () => {
  const database = { id: 'db' };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCollection.mockImplementation((db, path) => ({ db, path }));
    mockDoc.mockImplementation((db, collectionName, id) => ({
      db,
      path: `${collectionName}/${id}`,
    }));
    mockWriteBatch.mockImplementation(() => mockBatch);
    mockBatch.commit.mockResolvedValue(undefined);
    mockGetDocsFromServer.mockImplementation(reference => Promise.resolve({
      docs: [{ ref: { path: `${reference.path}/child-1` } }],
    }));
  });

  it.each([
    ['project', deleteProjectAndData, 'projects', 'project-1'],
    ['workshop', deleteWorkshopAndData, 'workshops', 'workshop-1'],
  ])('deletes the %s children before deleting its parent', async (
    label,
    deleteEntity,
    collectionName,
    entityId
  ) => {
    await deleteEntity(database, entityId);

    expect(mockCollection).toHaveBeenCalledWith(
      database,
      `${collectionName}/${entityId}/signedStudents`
    );
    expect(mockCollection).toHaveBeenCalledWith(
      database,
      `${collectionName}/${entityId}/payments`
    );
    expect(mockBatch.delete).toHaveBeenCalledWith({
      path: `${collectionName}/${entityId}`,
      db: database,
    });
    expect(mockWriteBatch).toHaveBeenCalledTimes(2);
    expect(mockBatch.commit).toHaveBeenCalledTimes(2);
  });
});
