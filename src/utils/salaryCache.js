const SALARY_SUMMARY_PREFIX = 'salarySummary:';

export function invalidateSalarySummaries() {
  try {
    const keysToRemove = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(SALARY_SUMMARY_PREFIX)) keysToRemove.push(key);
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
  } catch (error) {
    // A blocked localStorage must never turn a successful Firebase write into
    // a user-visible failure. Salary can still be recalculated manually.
    console.error('Failed to invalidate cached salary summaries:', error);
  }
}
