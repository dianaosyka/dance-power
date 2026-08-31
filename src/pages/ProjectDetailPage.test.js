import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  mockCollection,
  mockDoc,
  mockGetDocsFromServer,
  mockRunTransaction,
  mockServerCollections,
  mockTimestampValue,
  mockTransaction,
  mockTransactionDocuments,
} from 'firebase/firestore';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import { invalidateSalarySummaries } from '../utils/salaryCache';
import ProjectDetailPage from './ProjectDetailPage';

const mockNavigate = jest.fn();
const mockUseParams = jest.fn();

jest.mock('firebase/firestore', () => {
  const serverCollections = new Map();
  const transactionDocuments = new Map();
  const timestampValue = { seconds: 456, nanoseconds: 0 };
  const getCollection = jest.fn();
  const getDocument = jest.fn();
  const getServerDocuments = jest.fn();
  const transaction = {
    get: jest.fn(),
    set: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const runFirestoreTransaction = jest.fn();

  return {
    mockCollection: getCollection,
    mockDoc: getDocument,
    mockGetDocsFromServer: getServerDocuments,
    mockRunTransaction: runFirestoreTransaction,
    mockServerCollections: serverCollections,
    mockTimestampValue: timestampValue,
    mockTransaction: transaction,
    mockTransactionDocuments: transactionDocuments,
    collection: getCollection,
    doc: getDocument,
    getDocsFromServer: getServerDocuments,
    runTransaction: runFirestoreTransaction,
    Timestamp: {
      now: () => timestampValue,
    },
  };
});

jest.mock('../context/firebase', () => ({
  useData: jest.fn(),
}));

jest.mock('../context/UserContext', () => ({
  useUser: jest.fn(),
}));

jest.mock('../utils/salaryCache', () => ({
  invalidateSalarySummaries: jest.fn(),
}));

jest.mock('../components/RefreshStatus', () => () => null);

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => mockUseParams(),
}), { virtual: true });

function querySnapshot(rows) {
  return {
    docs: rows.map(row => ({
      id: row.id,
      data: () => row.data,
    })),
  };
}

function documentSnapshot(exists, data = {}) {
  return {
    exists: () => exists,
    data: () => data,
  };
}

function setServerCollection(path, rows) {
  mockServerCollections.set(path, querySnapshot(rows));
}

function setTransactionDocument(path, exists, data = {}) {
  mockTransactionDocuments.set(path, documentSnapshot(exists, data));
}

function nestedCollectionPaths() {
  return mockCollection.mock.results
    .map(result => result.value?.path)
    .filter(Boolean);
}

function documentPaths() {
  return mockDoc.mock.results
    .map(result => result.value?.path)
    .filter(Boolean);
}

describe('ProjectDetailPage', () => {
  const database = { id: 'database' };
  const project = {
    id: 'project-1',
    name: 'Autumn Project',
    type: 'PROJECT',
    startDate: '2026-09-01',
    endDate: '2026-09-30',
    totalClasses: 5,
    price: 120,
    scheduleSlots: [
      { dayOfWeek: 2, time: '18:00' },
      { dayOfWeek: 4, time: '19:30' },
    ],
    coach: 'coach-1',
    signedStudentCount: 0,
  };
  const alice = {
    id: 'student-1',
    name: 'Alice Example',
    phone: '+421900111222',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockServerCollections.clear();
    mockTransactionDocuments.clear();
    mockCollection.mockImplementation((collectionDatabase, ...segments) => ({
      database: collectionDatabase,
      path: segments.join('/'),
    }));
    mockDoc.mockImplementation((documentDatabase, ...segments) => ({
      database: documentDatabase,
      path: segments.join('/'),
    }));
    mockGetDocsFromServer.mockImplementation(reference => Promise.resolve(
      mockServerCollections.get(reference.path) || querySnapshot([])
    ));
    mockTransaction.get.mockImplementation(reference => Promise.resolve(
      mockTransactionDocuments.get(reference.path) || documentSnapshot(false)
    ));
    mockRunTransaction.mockImplementation(async (transactionDatabase, updateFunction) => {
      expect(transactionDatabase).toBe(database);
      return updateFunction(mockTransaction);
    });
    mockUseParams.mockReturnValue({ projectId: 'project-1' });
    useUser.mockReturnValue({ user: { id: 'admin-1', role: 'admin' } });
    useData.mockReturnValue({
      db: database,
      projects: [project],
      projectsLoaded: true,
      projectsError: null,
      coaches: [{ id: 'coach-1', name: 'Amy Coach' }],
      students: [alice],
      studentsLoaded: true,
      studentsLoading: false,
      studentsError: null,
      studentsLastLoadedAt: Date.now(),
      refreshStudents: jest.fn().mockResolvedValue([alice]),
    });
    setServerCollection('projects/project-1/signedStudents', []);
    setServerCollection('projects/project-1/payments', []);
  });

  it('loads only the exact project collections and signs a searched student transactionally', async () => {
    setTransactionDocument('projects/project-1', true, { signedStudentCount: 2 });
    setTransactionDocument('projects/project-1/signedStudents/student-1', false);

    render(<ProjectDetailPage />);

    expect(await screen.findByText('No one is signed up yet.')).toBeInTheDocument();
    expect(nestedCollectionPaths().sort()).toEqual([
      'projects/project-1/payments',
      'projects/project-1/signedStudents',
    ]);
    expect(nestedCollectionPaths()).not.toContain('payments');

    fireEvent.change(screen.getByLabelText('Sign a student from the list'), {
      target: { value: 'Alice' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign' }));

    await waitFor(() => expect(mockTransaction.set).toHaveBeenCalledTimes(1));

    expect(mockTransaction.get).toHaveBeenNthCalledWith(1, {
      database,
      path: 'projects/project-1',
    });
    expect(mockTransaction.get).toHaveBeenNthCalledWith(2, {
      database,
      path: 'projects/project-1/signedStudents/student-1',
    });
    expect(mockTransaction.set).toHaveBeenCalledWith(
      { database, path: 'projects/project-1/signedStudents/student-1' },
      {
        studentId: 'student-1',
        studentName: 'Alice Example',
        signedAt: mockTimestampValue,
        signedBy: 'admin-1',
        signedByRole: 'admin',
      }
    );
    expect(mockTransaction.update).toHaveBeenCalledWith(
      { database, path: 'projects/project-1' },
      { signedStudentCount: 3 }
    );
    expect(documentPaths()).not.toContain('students/student-1');
    expect(documentPaths()).not.toContain('payments/student-1');
    expect(mockTransaction.delete).not.toHaveBeenCalled();
    expect(invalidateSalarySummaries).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Alice Example was signed up for this project.'))
      .toBeInTheDocument();
  });

  it('sends a coach to the project tab with project and student preselected', async () => {
    useUser.mockReturnValue({ user: { id: 'coach-1', role: 'coach' } });
    setServerCollection('projects/project-1/signedStudents', [{
      id: 'student-1',
      data: {
        studentId: 'student-1',
        studentName: 'Alice Example',
      },
    }]);
    render(<ProjectDetailPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add payment' }));
    expect(mockNavigate).toHaveBeenCalledWith(
      '/add-payment?mode=project&projectId=project-1&studentId=student-1&returnTo=%2Fproject%2Fproject-1'
    );
    expect(mockTransaction.set).not.toHaveBeenCalled();
  });

  it('shows a first installment as 50% paid and offers the second payment', async () => {
    setServerCollection('projects/project-1/signedStudents', [{
      id: 'student-1',
      data: {
        studentId: 'student-1',
        studentName: 'Alice Example',
      },
    }]);
    setServerCollection('projects/project-1/payments', [{
      id: 'student-1--first_half',
      data: {
        studentId: 'student-1',
        studentName: 'Alice Example',
        status: 'active',
        amount: 60,
        paymentPart: 'first_half',
        paymentMethod: 'card',
        createdAt: '01.09.2026',
      },
    }]);

    render(<ProjectDetailPage />);
    expect(await screen.findByText('50% paid · 60.00€')).toBeInTheDocument();
    expect(screen.getByText(/First payment \(50%\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add second 50%' }));
    expect(mockNavigate).toHaveBeenCalledWith(
      '/add-payment?mode=project&projectId=project-1&studentId=student-1&returnTo=%2Fproject%2Fproject-1'
    );
  });
});
