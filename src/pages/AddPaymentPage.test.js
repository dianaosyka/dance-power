import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { mockBatch } from 'firebase/firestore';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import { useNavigate } from 'react-router-dom';
import AddPaymentPage from './AddPaymentPage';

jest.mock('firebase/firestore', () => {
  const batch = {
    set: jest.fn(),
    update: jest.fn(),
    commit: jest.fn().mockResolvedValue(undefined),
  };

  return {
    mockBatch: batch,
    collection: (database, name) => ({ kind: 'collection', database, name }),
    doc: (first, collectionName, documentId) => {
      if (first?.kind === 'collection') return { id: 'generated-payment-id' };
      return { path: `${collectionName}/${documentId}` };
    },
    Timestamp: {
      now: () => ({ seconds: 123, nanoseconds: 0 }),
    },
    arrayUnion: (...values) => ({ values }),
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
  useLocation: () => ({ search: '' }),
}), { virtual: true });

jest.mock('../components/RefreshStatus', () => () => null);

describe('AddPaymentPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBatch.commit.mockResolvedValue(undefined);
    useNavigate.mockReturnValue(jest.fn());
    useUser.mockReturnValue({ user: { id: 'admin-1', role: 'admin' } });
    useData.mockReturnValue({
      students: [{ id: 'student-1', name: 'Alice Example' }],
      groups: [{ id: 'group-1', name: 'Group A' }],
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
      target: { value: 'workshops' },
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
            reason: 'workshops',
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
});
