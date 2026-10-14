import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import PageBackButton from './PageBackButton';

const mockNavigate = jest.fn();
const mockUseLocation = jest.fn();

jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockUseLocation(),
}), { virtual: true });

describe('PageBackButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorage.clear();
  });

  it.each([
    '/students',
    '/group/group-1',
    '/group/group-1/class/14.10.2026',
    '/student/student-1',
  ])('always goes back one history entry from %s', pathname => {
    mockUseLocation.mockReturnValue({ pathname });
    sessionStorage.setItem('dancePowerNavigationStack:v1', JSON.stringify([
      { pathname: '/groups', href: '/groups' },
      { pathname, href: pathname },
    ]));
    render(<PageBackButton />);

    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/groups', { replace: true });
  });
});
