import { useEffect } from 'react';
import {
  useLocation,
  useNavigate,
  useNavigationType,
} from 'react-router-dom';

const STORAGE_KEY = 'dancePowerNavigationStack:v1';
const PENDING_BACK_KEY = 'dancePowerNavigationPendingBack:v1';
const DEFAULT_ROUTE = '/groups';

function currentEntry(location) {
  return {
    pathname: location.pathname,
    href: `${location.pathname}${location.search}${location.hash}`,
  };
}

function readStack() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
    return Array.isArray(parsed)
      ? parsed.filter(item => item?.pathname && item?.href)
      : [];
  } catch {
    return [];
  }
}

function writeStack(stack) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stack.slice(-60)));
}

export function AppNavigationHistory() {
  const location = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    const entry = currentEntry(location);
    const pendingBack = sessionStorage.getItem(PENDING_BACK_KEY);
    if (pendingBack === entry.href) {
      sessionStorage.removeItem(PENDING_BACK_KEY);
      return;
    }

    const stack = readStack();
    const last = stack[stack.length - 1];
    if (!last) {
      writeStack([entry]);
      return;
    }

    // Query/hash changes on the same page are state changes, not new screens.
    if (last.pathname === entry.pathname) {
      writeStack([...stack.slice(0, -1), entry]);
      return;
    }

    if (navigationType === 'REPLACE') {
      writeStack([...stack.slice(0, -1), entry]);
      return;
    }

    if (navigationType === 'POP') {
      const previousIndex = stack.map(item => item.pathname).lastIndexOf(entry.pathname);
      writeStack(previousIndex >= 0 ? stack.slice(0, previousIndex + 1) : [...stack, entry]);
      return;
    }

    writeStack([...stack, entry]);
  }, [location, navigationType]);

  return null;
}

export function useAppBack() {
  const navigate = useNavigate();
  const location = useLocation();

  return () => {
    const entry = currentEntry(location);
    const stack = readStack();
    let currentIndex = stack.length - 1;

    while (currentIndex >= 0 && stack[currentIndex].pathname !== entry.pathname) {
      currentIndex -= 1;
    }

    const previous = currentIndex > 0 ? stack[currentIndex - 1] : null;
    const target = previous?.href || DEFAULT_ROUTE;
    const nextStack = previous ? stack.slice(0, currentIndex) : [{ pathname: DEFAULT_ROUTE, href: DEFAULT_ROUTE }];

    writeStack(nextStack);
    sessionStorage.setItem(PENDING_BACK_KEY, target);
    navigate(target, { replace: true });
  };
}
