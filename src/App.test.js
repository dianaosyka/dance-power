import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';

jest.mock('react-router-dom', () => ({
  BrowserRouter: ({ children }) => children,
  Routes: ({ children }) => children,
  Route: ({ element }) => element || null,
  Navigate: () => null,
  useNavigate: () => jest.fn(),
}), { virtual: true });

jest.mock('./context/firebase', () => ({
  DataProvider: ({ children }) => children,
  useData: () => ({ db: {} }),
}));

jest.mock('./pages/GroupsPage', () => () => null);
jest.mock('./pages/StudentsListPage', () => () => null);
jest.mock('./pages/AddPaymentPage', () => () => null);
jest.mock('./pages/GroupClassesPage', () => () => null);
jest.mock('./pages/StudentDetailPage', () => () => null);
jest.mock('./pages/GroupClassDetailPage', () => () => null);
jest.mock('./pages/PaymentHistoryPage', () => () => null);
jest.mock('./pages/SalaryPage', () => () => null);
jest.mock('./pages/SchedulePage', () => () => null);
jest.mock('./pages/CreateGroupPage', () => () => null);
jest.mock('./pages/ProjectsPage', () => () => null);
jest.mock('./pages/ProjectDetailPage', () => () => null);
jest.mock('./pages/WorkshopsPage', () => () => null);
jest.mock('./pages/WorkshopDetailPage', () => () => null);
jest.mock('./pages/CreateWorkshopPage', () => () => null);

test('renders the login choices for a signed-out user', () => {
  render(<App />);

  expect(screen.getByRole('heading', { name: 'Login' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /teacher/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /student/i })).toBeInTheDocument();
});
