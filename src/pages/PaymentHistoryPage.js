import React, { useMemo, useState } from 'react';
import { useData } from '../context/firebase';
import './PaymentHistoryPage.css';

function PaymentHistoryPage() {
  const { payments, students, groups } = useData();
  const [sortBy, setSortBy] = useState('timestamp');

  const getStudentName = (id) =>
    students.find(s => s.id === id)?.name?.toUpperCase() || 'UNKNOWN';

  const getGroupNames = (ids) =>
    ids.map(id => groups.find(g => g.id === id)?.name || id).join(', ');

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

  return (
    <div className="payment-history-page">
      <h2 className="history-title">💳 PAYMENT HISTORY</h2>
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
        {sortedPayments.map((p, i) => (
          <li key={i} className="transaction-card">
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
