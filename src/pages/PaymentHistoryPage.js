import React from 'react';
import { useData } from '../context/DataContext';
import './PaymentHistoryPage.css';

function PaymentHistoryPage() {
  const { payments, students, groups } = useData();

  const getStudentName = (id) =>
    students.find(s => s.id === id)?.name?.toUpperCase() || 'UNKNOWN';

  const getGroupNames = (ids) =>
    ids.map(id => groups.find(g => g.id === id)?.name || id).join(', ');

  const sortedPayments = [...payments].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );

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
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default PaymentHistoryPage;  
