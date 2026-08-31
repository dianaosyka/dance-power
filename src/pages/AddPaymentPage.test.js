import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  mockBatch,
  mockGetDocsFromServer,
  mockRunTransaction,
  mockTransaction,
  mockTransactionDocuments,
} from 'firebase/firestore';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import { useNavigate } from 'react-router-dom';
import AddPaymentPage from './AddPaymentPage';

const mockLocation = { search: '' };

jest.mock('firebase/firestore', () => {
  const batch = {
    set: jest.fn(),
    update: jest.fn(),
    commit: jest.fn().mockResolvedValue(undefined),
  };
  const transactionDocuments = new Map();
  const transaction = {
    get: jest.fn(reference => Promise.resolve(
      transactionDocuments.get(reference.path) || { exists: () => false, data: () => ({}) }
    )),
    set: jest.fn(),
  };
  const getDocsFromServer = jest.fn();
  const runTransaction = jest.fn(async (database, callback) => callback(transaction));

  return {
    mockBatch: batch,
    mockGetDocsFromServer: getDocsFromServer,
    mockRunTransaction: runTransaction,
    mockTransaction: transaction,
    mockTransactionDocuments: transactionDocuments,
    collection: (database, name) => ({ kind: 'collection', database, name, path: name }),
    doc: (first, collectionName, documentId) => {
      if (first?.kind === 'collection') return { id: 'generated-payment-id' };
      return { path: `${collectionName}/${documentId}` };
    },
    Timestamp: {
      now: () => ({ seconds: 123, nanoseconds: 0 }),
    },
    arrayUnion: (...values) => ({ values }),
    getDocsFromServer,
    runTransaction,
    writeBatch: () => batch,
  };
});

jest.mock('../context/firebase', () => ({
  useData: jest.fn(),
}));

jest.mock('../context/UserContext', () => ({
  useUser: jest.fn(),
}));

jest.mock('react-router-dom', () => ({
  useNavigate: jest.fn(),
  useLocation: () => mockLocation,
}), { virtual: true });

jest.mock('../components/RefreshStatus', () => () => null);

describe('AddPaymentPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLocation.search = '';
    mockBatch.commit.mockResolvedValue(undefined);
    mockTransactionDocuments.clear();
    mockGetDocsFromServer.mockReset();
    mockRunTransaction.mockImplementation(async (database, callback) => callback(mockTransaction));
    mockTransaction.get.mockImplementation(reference => Promise.resolve(
      mockTransactionDocuments.get(reference.path) || {
        id: reference.path.split('/').pop(),
        exists: () => false,
        data: () => ({}),
      }
    ));
    mockTransaction.set.mockClear();
    useNavigate.mockReturnValue(jest.fn());
    useUser.mockReturnValue({ user: { id: 'admin-1', role: 'admin' } });
    useData.mockReturnValue({
      students: [{ id: 'student-1', name: 'Alice Example' }],
      groups: [{ id: 'group-1', name: 'Group A' }],
      projects: [],
      db: { id: 'database' },
      studentsLoaded: true,
      studentsLoading: false,
      studentsError: null,
      studentsLastLoadedAt: Date.now(),
      refreshStudents: jest.fn(),
      upsertPayment: jest.fn(),
      patchStudent: jest.fn(),
    });
  });

  it('stores an other payment inside the date-from monthly document', async () => {
    const navigate = jest.fn();
    useNavigate.mockReturnValue(navigate);
    const { container } = render(<AddPaymentPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Other' }));
    fireEvent.change(screen.getByPlaceholderText('Search student'), {
      target: { value: 'Alice' },
    });
    fireEvent.click(screen.getByText('Alice Example'));
    fireEvent.change(container.querySelector('input[inputmode="decimal"]'), {
      target: { value: '42.50' },
    });

    const dateInputs = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0], { target: { value: '2026-08-20' } });
    fireEvent.change(dateInputs[1], { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByText('REASON:').parentElement.querySelector('select'), {
      target: { value: 'private_lessons' },
    });
    fireEvent.click(screen.getByRole('button', { name: '✅' }));

    await waitFor(() => {
      expect(mockBatch.commit).toHaveBeenCalledTimes(1);
    });

    expect(mockBatch.update).not.toHaveBeenCalled();
    expect(mockBatch.set).toHaveBeenCalledWith(
      { path: 'otherpayments/08.2026' },
      {
        month: '08.2026',
        updatedAt: { seconds: 123, nanoseconds: 0 },
        payments: {
          'generated-payment-id': {
            studentId: 'student-1',
            amount: 42.5,
            dateFrom: '01.08.2026',
            createdAt: '20.08.2026',
            timestamp: { seconds: 123, nanoseconds: 0 },
            status: 'active',
            paymentMethod: 'card',
            reason: 'private_lessons',
            paymentKind: 'other',
          },
        },
      },
      { merge: true }
    );
    expect(navigate).toHaveBeenCalledWith('/payment-history');
  });

  it('restricts coaches to cash group payments', async () => {
    const navigate = jest.fn();
    useNavigate.mockReturnValue(navigate);
    useUser.mockReturnValue({ user: { id: 'coach-1', role: 'coach' } });
    const { container } = render(<AddPaymentPage />);

    expect(screen.queryByRole('button', { name: 'Other' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Card' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cash' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.change(screen.getByPlaceholderText('Search student'), {
      target: { value: 'Alice' },
    });
    fireEvent.click(screen.getByText('Alice Example'));
    fireEvent.change(container.querySelector('input[inputmode="decimal"]'), {
      target: { value: '18' },
    });
    const dateInputs = container.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0], { target: { value: '2026-08-20' } });
    fireEvent.change(dateInputs[1], { target: { value: '2026-08-01' } });
    fireEvent.change(screen.getByText('TYPE:').parentElement.querySelector('select'), {
      target: { value: '1' },
    });
    fireEvent.click(screen.getByText('Group A').closest('label').querySelector('input'));
    fireEvent.click(screen.getByRole('button', { name: '✅' }));

    await waitFor(() => expect(mockBatch.commit).toHaveBeenCalledTimes(1));

    expect(mockBatch.set).toHaveBeenCalledWith(
      { id: 'generated-payment-id' },
      expect.objectContaining({
        studentId: 'student-1',
        amount: 18,
        paymentMethod: 'cash',
        groups: ['group-1'],
        type: 1,
      })
    );
    expect(navigate).toHaveBeenCalledWith('/student/student-1');
  });

  it('stores a coach project payment as the first 50% installment inside that project', async () => {
    const navigate = jest.fn();
    useNavigate.mockReturnValue(navigate);
    useUser.mockReturnValue({ user: { id: 'coach-1', role: 'coach' } });
    useData.mockReturnValue({
      students: [{ id: 'student-1', name: 'Alice Example' }],
      groups: [{ id: 'group-1', name: 'Group A' }],
      projects: [{
        id: 'project-1',
        name: 'Project A',
        price: 120,
        startDate: '2026-09-01',
      }],
      db: { id: 'database' },
      studentsLoaded: true,
      studentsLoading: false,
      studentsError: null,
      studentsLastLoadedAt: Date.now(),
      refreshStudents: jest.fn(),
      upsertPayment: jest.fn(),
      patchStudent: jest.fn(),
    });
    mockGetDocsFromServer.mockImplementation(reference => Promise.resolve({
      docs: reference.path.endsWith('/signedStudents')
        ? [{
            id: 'student-1',
            data: () => ({ studentId: 'student-1', studentName: 'Alice Example' }),
          }]
        : [],
    }));
    mockTransactionDocuments.set('projects/project-1', {
      exists: () => true,
      data: () => ({}),
    });
    mockTransactionDocuments.set('projects/project-1/signedStudents/student-1', {
      exists: () => true,
      data: () => ({ studentId: 'student-1' }),
    });

    render(<AddPaymentPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    fireEvent.change(screen.getByText('PROJECT:').parentElement.querySelector('select'), {
      target: { value: 'project-1' },
    });
    await waitFor(() => expect(mockGetDocsFromServer).toHaveBeenCalledTimes(2));

    fireEvent.change(screen.getByPlaceholderText('Search student'), {
      target: { value: 'Alice' },
    });
    fireEvent.click(screen.getByText('Alice Example'));
    const partSelect = screen.getByText('PROJECT PAYMENT:').parentElement.querySelector('select');
    fireEvent.change(partSelect, { target: { value: 'first_half' } });
    expect(screen.getByDisplayValue('60')).toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Card' })).toBeDisabled();
    fireEvent.change(document.querySelector('input[type="date"]'), {
      target: { value: '2026-08-30' },
    });
    fireEvent.click(screen.getByRole('button', { name: '✅' }));

    await waitFor(() => expect(mockRunTransaction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockTransaction.set).toHaveBeenCalledTimes(1));
    expect(mockTransaction.set).toHaveBeenCalledWith(
      { path: 'projects/project-1/payments/student-1--first_half' },
      expect.objectContaining({
        studentId: 'student-1',
        amount: 60,
        dateFrom: '01.09.2026',
        createdAt: '30.08.2026',
        paymentKind: 'project',
        paymentPart: 'first_half',
        paymentPlan: 'split',
        installmentNumber: 1,
        installmentCount: 2,
        paymentMethod: 'cash',
        recordedBy: 'coach-1',
        recordedByRole: 'coach',
      })
    );
    expect(mockBatch.set).not.toHaveBeenCalled();
    expect(mockBatch.update).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/project/project-1');
  });

  it('stores a workshop payment inside the selected workshop and forces coach cash', async () => {
    const navigate = jest.fn();
    useNavigate.mockReturnValue(navigate);
    useUser.mockReturnValue({ user: { id: 'coach-1', role: 'coach' } });
    useData.mockReturnValue({
      students: [{ id: 'student-1', name: 'Alice Example' }], groups: [], projects: [],
      workshops: [{ id: 'workshop-1', name: 'Jazz Day', date: '2026-09-20', price: 80 }],
      db: { id: 'database' }, studentsLoaded: true, studentsLoading: false,
      studentsError: null, studentsLastLoadedAt: 1, refreshStudents: jest.fn(),
      upsertPayment: jest.fn(), patchStudent: jest.fn(),
    });
    mockGetDocsFromServer.mockImplementation(reference => Promise.resolve({
      docs: reference.path.endsWith('/signedStudents')
        ? [{ id: 'student-1', data: () => ({ studentId: 'student-1', studentName: 'Alice Example' }) }]
        : [],
    }));
    mockTransactionDocuments.set('workshops/workshop-1', { exists: () => true, data: () => ({}) });
    mockTransactionDocuments.set('workshops/workshop-1/signedStudents/student-1', { exists: () => true, data: () => ({}) });
    mockLocation.search = '?mode=workshop&workshopId=workshop-1&studentId=student-1';

    render(<AddPaymentPage />);
    await waitFor(() => expect(mockGetDocsFromServer).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByPlaceholderText('Search student')).toHaveValue('Alice Example'));
    const amountInput = screen.getByDisplayValue('80');
    expect(amountInput).not.toHaveAttribute('readonly');
    fireEvent.change(amountInput, { target: { value: '65' } });
    fireEvent.change(document.querySelector('input[type="date"]'), { target: { value: '2026-08-31' } });
    fireEvent.click(screen.getByRole('button', { name: '✅' }));

    await waitFor(() => expect(mockTransaction.set).toHaveBeenCalledWith(
      { path: 'workshops/workshop-1/payments/student-1' },
      expect.objectContaining({
        studentId: 'student-1', amount: 65, dateFrom: '20.09.2026',
        createdAt: '31.08.2026', paymentKind: 'workshop', paymentMethod: 'cash',
      })
    ));
    expect(navigate).toHaveBeenCalledWith('/workshop/workshop-1');
  });
});
