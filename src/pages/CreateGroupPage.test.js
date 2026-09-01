import React, { act } from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import {
  mockAddDoc,
  mockCollection,
  mockTimestampValue,
} from 'firebase/firestore';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import { invalidateSalarySummaries } from '../utils/salaryCache';
import CreateGroupPage from './CreateGroupPage';

const mockNavigate = jest.fn();
const mockUseLocation = jest.fn();

jest.mock('firebase/firestore', () => {
  const addDocument = jest.fn();
  const getCollection = jest.fn((database, name) => ({ database, name }));
  const timestampValue = { seconds: 123, nanoseconds: 0 };

  return {
    mockAddDoc: addDocument,
    mockCollection: getCollection,
    mockTimestampValue: timestampValue,
    addDoc: addDocument,
    collection: getCollection,
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

jest.mock('react-router-dom', () => ({
  Navigate: ({ to, replace }) => require('react').createElement('div', {
    'data-testid': 'redirect',
    'data-to': to,
    'data-replace': String(Boolean(replace)),
  }),
  useLocation: () => mockUseLocation(),
  useNavigate: () => mockNavigate,
}), { virtual: true });

function fillRegularGroupForm() {
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: '  Hip Hop Lab  ' },
  });
  fireEvent.change(screen.getByLabelText('Coach'), {
    target: { value: 'coach-2' },
  });
  fireEvent.change(screen.getByLabelText('Type'), {
    target: { value: 'OPEN' },
  });
  fireEvent.change(screen.getByLabelText('Weekday'), {
    target: { value: '2' },
  });
  fireEvent.change(screen.getByLabelText('Time'), {
    target: { value: '18:30' },
  });
}

function fillProjectForm() {
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: '  Autumn Project  ' },
  });
  fireEvent.change(screen.getByLabelText('Coach'), {
    target: { value: 'coach-1' },
  });
  fireEvent.change(screen.getByLabelText('Starts'), {
    target: { value: '2026-09-01' },
  });
  fireEvent.change(screen.getByLabelText('Ends'), {
    target: { value: '2026-09-30' },
  });
  fireEvent.change(screen.getByLabelText('Classes'), {
    target: { value: '5' },
  });
  fireEvent.change(screen.getByLabelText('Price per student (€)'), {
    target: { value: '120,50' },
  });
  fireEvent.change(screen.getByLabelText('Classes per week'), {
    target: { value: '2' },
  });

  const firstSlot = screen.getByText('Class 1').closest('fieldset');
  const secondSlot = screen.getByText('Class 2').closest('fieldset');
  fireEvent.change(within(firstSlot).getByLabelText('Weekday'), {
    target: { value: '2' },
  });
  fireEvent.change(within(firstSlot).getByLabelText('Time'), {
    target: { value: '18:00' },
  });
  fireEvent.change(within(secondSlot).getByLabelText('Weekday'), {
    target: { value: '4' },
  });
  fireEvent.change(within(secondSlot).getByLabelText('Time'), {
    target: { value: '19:30' },
  });
}

describe('CreateGroupPage', () => {
  const database = { id: 'database' };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCollection.mockImplementation((collectionDatabase, name) => ({
      database: collectionDatabase,
      name,
    }));
    mockUseLocation.mockReturnValue({ search: '' });
    useUser.mockReturnValue({
      user: { id: 'admin-1', email: 'admin@example.com', role: 'admin' },
    });
    useData.mockReturnValue({
      db: database,
      coaches: [
        { id: 'coach-2', name: 'Zoey Coach' },
        { id: 'coach-1', name: 'Amy Coach' },
      ],
      coachesLoaded: true,
    });
    mockAddDoc.mockImplementation(async reference => ({
      id: reference.name === 'projects' ? 'project-1' : 'group-1',
    }));
  });

  it('creates a normalized regular group without writing to projects', async () => {
    render(<CreateGroupPage />);
    fillRegularGroupForm();
    fireEvent.click(screen.getByLabelText('Hide from regular lists'));
    fireEvent.click(screen.getByRole('button', { name: 'Create regular group' }));

    await waitFor(() => expect(mockAddDoc).toHaveBeenCalledTimes(1));

    expect(mockCollection).toHaveBeenCalledTimes(1);
    expect(mockCollection).toHaveBeenCalledWith(database, 'groups');
    expect(mockCollection).not.toHaveBeenCalledWith(database, 'projects');
    expect(mockAddDoc).toHaveBeenCalledWith(
      { database, name: 'groups' },
      {
        name: 'Hip Hop Lab',
        type: 'OPEN',
        dayOfWeek: 2,
        time: '18:30',
        schedule: 'TUESDAY 18:30',
        coach: 'coach-2',
        signedStudents: [],
        hidden: true,
        createdAt: mockTimestampValue,
        createdBy: 'admin-1',
      }
    );
    expect(invalidateSalarySummaries).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/group/group-1');
  });

  it('creates a twice-weekly project only inside projects', async () => {
    mockUseLocation.mockReturnValue({ search: '?kind=project' });
    render(<CreateGroupPage />);
    fillProjectForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));

    await waitFor(() => expect(mockAddDoc).toHaveBeenCalledTimes(1));

    expect(mockCollection).toHaveBeenCalledTimes(1);
    expect(mockCollection).toHaveBeenCalledWith(database, 'projects');
    expect(mockCollection).not.toHaveBeenCalledWith(database, 'groups');
    expect(mockAddDoc).toHaveBeenCalledWith(
      { database, name: 'projects' },
      {
        name: 'Autumn Project',
        type: 'PROJECT',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        totalClasses: 5,
        price: 120.5,
        scheduleSlots: [
          { dayOfWeek: 2, time: '18:00' },
          { dayOfWeek: 4, time: '19:30' },
        ],
        schedule: 'TUESDAY 18:00 / THURSDAY 19:30',
        coach: 'coach-1',
        hidden: false,
        signedStudentCount: 0,
        createdAt: mockTimestampValue,
        createdBy: 'admin-1',
      }
    );
    expect(invalidateSalarySummaries).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/project/project-1');
  });

  it('redirects non-admin users without exposing the form', () => {
    useUser.mockReturnValue({ user: { id: 'coach-1', role: 'coach' } });

    render(<CreateGroupPage />);

    expect(screen.getByTestId('redirect')).toHaveAttribute('data-to', '/groups');
    expect(screen.getByTestId('redirect')).toHaveAttribute('data-replace', 'true');
    expect(screen.queryByRole('button', { name: 'Create regular group' }))
      .not.toBeInTheDocument();
    expect(mockAddDoc).not.toHaveBeenCalled();
  });

  it('does not start a second write while the first submit is pending', async () => {
    let resolveWrite;
    const pendingWrite = new Promise(resolve => {
      resolveWrite = resolve;
    });
    mockAddDoc.mockReturnValue(pendingWrite);
    render(<CreateGroupPage />);
    fillRegularGroupForm();

    const form = screen.getByRole('button', { name: 'Create regular group' }).closest('form');
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(mockAddDoc).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();

    await act(async () => {
      resolveWrite({ id: 'group-1' });
      await pendingWrite;
    });

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/group/group-1'));
    expect(mockAddDoc).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });
});
