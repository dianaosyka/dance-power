import React from 'react';
import { useData } from '../context/firebase';
import './PaymentHistoryPage.css';

function PaymentHistoryPage() {
  const { payments, students, groups } = useData();

  const getStudentName = (id) =>
    students.find(s => s.id === id)?.name?.toUpperCase() || 'UNKNOWN';

  const getGroupNames = (ids) =>
    ids.map(id => groups.find(g => g.id === id)?.name || id).join(', ');

  const parseDateStr = (str) => {
    const [dd, mm, yyyy] = str.split('.');
    return new Date(`${yyyy}-${mm}-${dd}`);
  };

  const sortedPayments = [...payments].sort((a, b) => {
    const dateA = a.createdAt ? parseDateStr(a.createdAt) : new Date((a.timestamp?.seconds || 0) * 1000);
    const dateB = b.createdAt ? parseDateStr(b.createdAt) : new Date((b.timestamp?.seconds || 0) * 1000);
    return dateB - dateA; // Newest first
  });

  const formatTimestamp = (ts) => {
    if (!ts || !ts.seconds) return '—';
    const date = new Date(ts.seconds * 1000);
    return date.toLocaleString();
  };

  return (
    <div className="payment-history-page">
      <h2 className="history-title">💳 PAYMENT HISTORY</h2>
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
              <div><b>Date from:</b> {p.dateFrom}</div>
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
