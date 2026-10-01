import React, { useCallback, useEffect, useState } from 'react';
import { collection, doc, getDocFromServer, getDocsFromServer } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import {
  getClosedSalaryMonths,
  isAdminSalaryResolved,
  isCoachSalaryResolved,
} from '../utils/salaryWarnings';

function SalaryDeadlineWarnings() {
  const { db } = useData();
  const { user } = useUser();
  const navigate = useNavigate();
  const [warnings, setWarnings] = useState([]);
  const [error, setError] = useState('');

  const loadWarnings = useCallback(async () => {
    if (!user?.id || (user.role !== 'admin' && user.role !== 'coach')) return;
    setError('');
    try {
      const closedMonths = getClosedSalaryMonths();
      const results = await Promise.all(closedMonths.map(async month => {
        if (user.role === 'coach') {
          const snapshot = await getDocFromServer(
            doc(db, 'salary', month.documentId, 'coaches', user.id)
          );
          return isCoachSalaryResolved(snapshot.exists() ? snapshot.data() : null)
            ? null
            : month;
        }

        const snapshot = await getDocsFromServer(
          collection(db, 'salary', month.documentId, 'coaches')
        );
        const records = snapshot.docs.map(item => item.data());
        return isAdminSalaryResolved(records) ? null : month;
      }));
      setWarnings(results.filter(Boolean).reverse());
    } catch (err) {
      console.error('Failed to load salary deadline warnings:', err);
      setError('Salary warnings could not be loaded.');
    }
  }, [db, user?.id, user?.role]);

  useEffect(() => {
    loadWarnings();
  }, [loadWarnings]);

  if (!warnings.length && !error) return null;

  const openSalaryMonth = monthValue => {
    localStorage.setItem('salarySelectedMonth', monthValue);
    navigate('/salary');
  };

  return (
    <section className="salary-deadline-warnings" aria-label="Overdue salary warnings">
      {error && <p>{error}</p>}
      {warnings.map(warning => (
        <button
          key={warning.documentId}
          type="button"
          onClick={() => openSalaryMonth(warning.monthValue)}
        >
          <span aria-hidden="true">⚠️</span>
          <span>
            <strong>Salary · {warning.documentId}</strong>
            <small>
              {user.role === 'admin'
                ? 'Some coach salaries are not marked as paid'
                : 'Confirm that your salary matches'}
            </small>
          </span>
          <span aria-hidden="true">➔</span>
        </button>
      ))}
    </section>
  );
}

export default SalaryDeadlineWarnings;

