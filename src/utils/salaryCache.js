const SALARY_SUMMARY_PREFIX = 'salarySummary:';

export function invalidateSalarySummaries() {
  try {
    const invalidatedAt = Date.now();
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(SALARY_SUMMARY_PREFIX)) continue;
      const savedValue = localStorage.getItem(key);
      try {
        const summary = JSON.parse(savedValue);
        if (summary && typeof summary === 'object') {
          localStorage.setItem(key, JSON.stringify({ ...summary, invalidatedAt }));
        }
      } catch (parseError) {
        // Preserve an unreadable value as well. The salary screen can decide
        // how to recover instead of a background mutation deleting user data.
      }
    }
  } catch (error) {
    // A blocked localStorage must never turn a successful Firebase write into
    // a user-visible failure. Salary can still be recalculated manually.
    console.error('Failed to invalidate cached salary summaries:', error);
  }
}
