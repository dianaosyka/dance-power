import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import PaymentHistoryPage from './PaymentHistoryPage';

const mockGetOtherPaymentHistoryCache = jest.fn();
const mockGetProjectPaymentHistoryCache = jest.fn();

jest.mock('../context/firebase', () => ({
  STAFF_DATA_CACHE_TTL_MS: 60_000,
  useData: jest.fn(),
}));

jest.mock('../context/UserContext', () => ({
  useUser: jest.fn(),
}));

jest.mock('react-router-dom', () => ({
  useNavigate: jest.fn(),
}), { virtual: true });

jest.mock('../utils/otherPaymentsCache', () => ({
  getOtherPaymentHistoryCache: (...args) => mockGetOtherPaymentHistoryCache(...args),
  hasFreshOtherPaymentHistory: () => true,
  loadOtherPaymentHistory: () => Promise.resolve({ payments: [], loadedAt: 1 }),
}));

jest.mock('../utils/projectPaymentsCache', () => ({
  getProjectPaymentHistoryCache: (...args) => mockGetProjectPaymentHistoryCache(...args),
  hasFreshProjectPaymentHistory: () => true,
  loadProjectPaymentHistory: () => Promise.resolve({ payments: [], loadedAt: 1 }),
}));

jest.mock('../utils/workshopPaymentsCache', () => ({
  getWorkshopPaymentHistoryCache: () => ({ payments: [], loadedAt: 1 }),
  hasFreshWorkshopPaymentHistory: () => true,
  loadWorkshopPaymentHistory: () => Promise.resolve({ payments: [], loadedAt: 1 }),
}));

jest.mock('../components/RefreshStatus', () => () => null);

describe('PaymentHistoryPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOtherPaymentHistoryCache.mockReturnValue({ payments: [], loadedAt: 1 });
    mockGetProjectPaymentHistoryCache.mockReturnValue({ payments: [], loadedAt: 1 });
  });

  it('renders the compact payment summary and reveals details from its arrow', () => {
    const navigate = jest.fn();
    useNavigate.mockReturnValue(navigate);
    useUser.mockReturnValue({ user: { id: 'admin-1', role: 'admin' } });
    useData.mockReturnValue({
      payments: [{
        id: 'payment-1',
        studentId: 'student-1',
        amount: 9,
        createdAt: '20.08.2026',
        dateFrom: '11.08.2026',
        timeFrom: '17:30',
        discount: 10,
        groups: ['group-1'],
        paymentMethod: 'card',
        timestamp: { seconds: 1_786_563_600 },
        type: 10,
      }],
      students: [{ id: 'student-1', name: 'aLICE eXAMPLE' }],
      groups: [{ id: 'group-1', name: 'HIP HOP', type: 'OPEN' }],
      db: { id: 'database' },
      studentsLoaded: true,
      paymentsLoaded: true,
      studentsLoading: false,
      paymentsLoading: false,
      studentsError: null,
      paymentsError: null,
      studentsLastLoadedAt: 1,
      paymentsLastLoadedAt: 1,
      refreshStudents: jest.fn(),
      refreshPayments: jest.fn(),
    });

    render(<PaymentHistoryPage />);

    expect(screen.getByRole('tab', { name: 'Payment date' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Example Alice')).toBeInTheDocument();
    expect(screen.getByText('20. aug')).toBeInTheDocument();
    expect(screen.getByText('Alice Example hip hop open 11.8. 17:30')).toBeInTheDocument();
    expect(screen.getByText('€ 9,00')).toBeInTheDocument();
    expect(screen.getByText('payment for groups')).toBeInTheDocument();

    ['paid by', 'payment date', 'classes', 'groups', 'class type', 'date from', 'discount', 'timestamp']
      .forEach(label => expect(screen.queryByText(label)).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /show all payment information/i }));

    ['paid by', 'payment date', 'classes', 'groups', 'class type', 'date from', 'discount', 'timestamp']
      .forEach(label => expect(screen.getByText(label)).toBeInTheDocument());
    expect(screen.getByText('paid by').nextElementSibling).toHaveTextContent('card');
    expect(screen.getByText('payment date').nextElementSibling).toHaveTextContent('20.08.2026');
    expect(screen.getByText('classes').nextElementSibling).toHaveTextContent('10');
    expect(screen.getByText('groups').nextElementSibling).toHaveTextContent('hip hop');
    expect(screen.getByText('class type').nextElementSibling).toHaveTextContent('open');
    expect(screen.getByText('date from').nextElementSibling).toHaveTextContent('11.08.2026');
    expect(screen.getByText('discount').nextElementSibling).toHaveTextContent('10%');
    expect(navigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /hide all payment information/i }));
    expect(screen.queryByText('discount')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add payment' }));
    expect(navigate).toHaveBeenCalledWith('/add-payment');
  });

  it('uses the same compact and expandable layout for other payments', () => {
    mockGetOtherPaymentHistoryCache.mockReturnValue({
      loadedAt: 1,
      payments: [{
        id: 'other-1',
        studentId: 'student-1',
        amount: 30,
        createdAt: '25.08.2026',
        dateFrom: '02.08.2026',
        paymentMethod: 'cash',
        reason: 'private_lessons',
        timestamp: { seconds: 1_786_563_600 },
      }],
    });
    useNavigate.mockReturnValue(jest.fn());
    useUser.mockReturnValue({ user: { id: 'admin-1', role: 'admin' } });
    useData.mockReturnValue({
      payments: [],
      students: [{ id: 'student-1', name: 'ANDREA KOCIAOVÁ' }],
      groups: [],
      db: { id: 'database' },
      studentsLoaded: true,
      paymentsLoaded: true,
      studentsLoading: false,
      paymentsLoading: false,
      studentsError: null,
      paymentsError: null,
      studentsLastLoadedAt: 1,
      paymentsLastLoadedAt: 1,
      refreshStudents: jest.fn(),
      refreshPayments: jest.fn(),
    });

    render(<PaymentHistoryPage />);

    expect(screen.getByText('Kociaová Andrea')).toBeInTheDocument();
    expect(screen.getByText('Andrea Kociaová private lessons 2.8.')).toBeInTheDocument();
    expect(screen.getByText('25. aug')).toBeInTheDocument();
    expect(screen.getByText('€ 30,00')).toBeInTheDocument();
    expect(screen.getByText('private lesson')).toBeInTheDocument();
    expect(screen.queryByText('reason')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /show all payment information/i }));

    expect(screen.getByText('reason').nextElementSibling).toHaveTextContent('private lessons');
    expect(screen.getByText('paid by').nextElementSibling).toHaveTextContent('cash');
    expect(screen.queryByText('classes')).not.toBeInTheDocument();
    expect(screen.queryByText('discount')).not.toBeInTheDocument();
  });

  it('includes nested project payments in global history', () => {
    mockGetProjectPaymentHistoryCache.mockReturnValue({
      loadedAt: 1,
      payments: [{
        id: 'student-1--first_half',
        projectId: 'project-1',
        studentId: 'student-1',
        amount: 60,
        createdAt: '30.08.2026',
        dateFrom: '01.09.2026',
        paymentMethod: 'cash',
        paymentPart: 'first_half',
        timestamp: { seconds: 1_788_048_000 },
      }],
    });
    const navigate = jest.fn();
    useNavigate.mockReturnValue(navigate);
    useUser.mockReturnValue({ user: { id: 'admin-1', role: 'admin' } });
    useData.mockReturnValue({
      payments: [],
      students: [{ id: 'student-1', name: 'Alice Example' }],
      groups: [],
      projects: [{ id: 'project-1', name: 'Summer Project' }],
      db: { id: 'database' },
      studentsLoaded: true,
      paymentsLoaded: true,
      studentsLoading: false,
      paymentsLoading: false,
      studentsError: null,
      paymentsError: null,
      studentsLastLoadedAt: 1,
      paymentsLastLoadedAt: 1,
      refreshStudents: jest.fn(),
      refreshPayments: jest.fn(),
    });

    render(<PaymentHistoryPage />);

    expect(screen.getByText('payment for project')).toBeInTheDocument();
    expect(screen.getByText(/summer project first payment \(50%\)/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /open payment for/i }));
    expect(navigate).toHaveBeenCalledWith(
      '/project/project-1?paymentId=student-1--first_half'
    );
  });
});
