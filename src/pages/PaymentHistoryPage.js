import React, { useMemo, useState } from 'react';
import { useData } from '../context/firebase';
import './PaymentHistoryPage.css';

function PaymentHistoryPage() {
  const {
    payments,
    students,
    groups,
    studentsLoaded,
    paymentsLoaded,
    studentsLoading,
    paymentsLoading,
    studentsError,
    paymentsError,
    studentsLastLoadedAt,
    paymentsLastLoadedAt,
    refreshStudents,
    refreshPayments,
  } = useData();
  const [sortBy, setSortBy] = useState('timestamp');

  const studentNamesById = useMemo(
    () => new Map(students.map(student => [
      student.id,
      student.name?.toUpperCase() || 'UNKNOWN',
    ])),
    [students]
  );
  const groupNamesById = useMemo(
    () => new Map(groups.map(group => [group.id, group.name || group.id])),
    [groups]
  );

  const getStudentName = (id) => studentNamesById.get(id) || 'UNKNOWN';
  const getGroupNames = (ids) =>
    (ids || []).map(id => groupNamesById.get(id) || id).join(', ');

  const getTimestampValue = (payment) => {
    if (typeof payment.timestamp?.toMillis === 'function') {
      return payment.timestamp.toMillis();
    }

    return (payment.timestamp?.seconds || 0) * 1000;
  };

  const getDateValue = (dateString) => {
    if (!dateString) return 0;

    const [day, month, year] = dateString.split('.').map(Number);
    if (day && month && year) return new Date(year, month - 1, day).getTime();

    const parsedDate = new Date(dateString).getTime();
    return Number.isNaN(parsedDate) ? 0 : parsedDate;
  };

  const sortedPayments = useMemo(() => {
    const getSortValue = (payment) => {
      if (sortBy === 'paymentDate') return getDateValue(payment.createdAt);
      if (sortBy === 'startDate') return getDateValue(payment.dateFrom);
      return getTimestampValue(payment);
    };

    return [...payments].sort((a, b) => {
      const difference = getSortValue(b) - getSortValue(a);
      return difference || getTimestampValue(b) - getTimestampValue(a);
    });
  }, [payments, sortBy]);

  const formatTimestamp = (ts) => {
    if (!ts || !ts.seconds) return '—';
    const date = new Date(ts.seconds * 1000);
    return date.toLocaleString();
  };

  const studentsLastLoadedText = studentsLastLoadedAt
    ? new Date(studentsLastLoadedAt).toLocaleString()
    : 'not loaded';
  const paymentsLastLoadedText = paymentsLastLoadedAt
    ? new Date(paymentsLastLoadedAt).toLocaleString()
    : 'not loaded';
  const dataLoaded = studentsLoaded && paymentsLoaded;
  const dataLoading = studentsLoading || paymentsLoading;

  const handleRefreshData = async () => {
    try {
      await Promise.all([refreshStudents(), refreshPayments()]);
    } catch (err) {
      // The shared data context exposes the error in the status message below.
      console.error('Failed to refresh payment history data:', err);
    }
  };

  return (
    <div className="payment-history-page">
      <h2 className="history-title">💳 PAYMENT HISTORY</h2>
      <div style={{ textAlign: 'center', marginBottom: '12px' }}>
        <button
          type="button"
          className="history-sort-tab"
          onClick={handleRefreshData}
          disabled={dataLoading}
        >
          {dataLoading ? 'Refreshing...' : 'Refresh data'}
        </button>
        <div role="status" style={{ fontSize: '0.8rem', marginTop: '4px' }}>
          {studentsError || paymentsError
            ? [
                studentsError ? `students: ${studentsError}` : '',
                paymentsError ? `payments: ${paymentsError}` : '',
              ].filter(Boolean).join(' | ')
            : dataLoaded
              ? `Last refreshed — students: ${studentsLastLoadedText}; payments: ${paymentsLastLoadedText}`
              : 'Payment history data has not been loaded.'}
        </div>
      </div>
      <div className="history-sort">
        <span className="history-sort-label">Sort by</span>
        <div className="history-sort-tabs" role="tablist" aria-label="Sort payments by">
          {[
            ['timestamp', 'Timestamp'],
            ['paymentDate', 'Payment date'],
            ['startDate', 'Start date'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={sortBy === value}
              className={`history-sort-tab${sortBy === value ? ' active' : ''}`}
              onClick={() => setSortBy(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <ul className="transaction-list">
        {!dataLoaded && dataLoading && (
          <li className="transaction-card">Loading payment history...</li>
        )}
        {dataLoaded && sortedPayments.length === 0 && (
          <li className="transaction-card">No payments found.</li>
        )}
        {dataLoaded && sortedPayments.map((p) => (
          <li key={p.id} className="transaction-card">
            <div className="top-line">
              <span className="amountSum">+{p.amount}€</span>
              <span className="date">{p.createdAt}</span>
            </div>
            <div className="info">
              <div><b>Student:</b> {getStudentName(p.studentId)}</div>
              <div><b>Classes:</b> {p.type}</div>
              <div><b>Groups:</b> {getGroupNames(p.groups)}</div>
              <div><b>Date from:</b> {p.dateFrom}{p.timeFrom ? ` ${p.timeFrom}` : ''}</div>
              <div><b>Discount:</b> {p.discount}%</div>
              <div><b>Timestamp:</b> {formatTimestamp(p.timestamp)}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default PaymentHistoryPage;
