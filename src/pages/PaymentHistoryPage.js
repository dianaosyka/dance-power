import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { STAFF_DATA_CACHE_TTL_MS, useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import {
  getOtherPaymentReasonLabel,
} from '../utils/otherPaymentsUtils';
import {
  getOtherPaymentHistoryCache,
  hasFreshOtherPaymentHistory,
  loadOtherPaymentHistory,
} from '../utils/otherPaymentsCache';
import { getPaymentMethodLabel } from '../utils/paymentMethodUtils';
import { getPaymentDetailPath } from '../utils/paymentNavigationUtils';
import RefreshStatus from '../components/RefreshStatus';
import './PaymentHistoryPage.css';

function PaymentHistoryPage() {
  const navigate = useNavigate();
  const {
    payments,
    students,
    groups,
    db,
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
  const { user } = useUser();
  const historyScope = user?.id || user?.role || 'signed-out';
  const [sortBy, setSortBy] = useState('timestamp');
  const [otherPayments, setOtherPayments] = useState(
    () => getOtherPaymentHistoryCache(historyScope).payments
  );
  const [otherPaymentsLoaded, setOtherPaymentsLoaded] = useState(
    () => getOtherPaymentHistoryCache(historyScope).loadedAt !== null
  );
  const [otherPaymentsLoading, setOtherPaymentsLoading] = useState(false);
  const [otherPaymentsError, setOtherPaymentsError] = useState('');
  const [otherPaymentsLastLoadedAt, setOtherPaymentsLastLoadedAt] = useState(
    () => getOtherPaymentHistoryCache(historyScope).loadedAt
  );

  const loadOtherPayments = useCallback(async ({ force = false } = {}) => {
    if (!force && hasFreshOtherPaymentHistory(historyScope, STAFF_DATA_CACHE_TTL_MS)) {
      const cachedHistory = getOtherPaymentHistoryCache(historyScope);
      setOtherPayments(cachedHistory.payments);
      setOtherPaymentsLoaded(true);
      setOtherPaymentsLastLoadedAt(cachedHistory.loadedAt);
      return cachedHistory.payments;
    }

    setOtherPaymentsLoading(true);
    setOtherPaymentsError('');
    try {
      const result = await loadOtherPaymentHistory(db, historyScope);
      setOtherPayments(result.payments);
      setOtherPaymentsLoaded(true);
      setOtherPaymentsLastLoadedAt(result.loadedAt);
      return result.payments;
    } catch (error) {
      setOtherPaymentsError(error?.message || String(error));
      throw error;
    } finally {
      setOtherPaymentsLoading(false);
    }
  }, [db, historyScope]);

  useEffect(() => {
    loadOtherPayments().catch(() => {});
  }, [loadOtherPayments]);

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

    const allPayments = [
      ...payments.map(payment => ({ ...payment, paymentKind: 'group' })),
      ...otherPayments.map(payment => ({ ...payment, paymentKind: 'other' })),
    ];

    return allPayments.sort((a, b) => {
      const difference = getSortValue(b) - getSortValue(a);
      return difference || getTimestampValue(b) - getTimestampValue(a);
    });
  }, [otherPayments, payments, sortBy]);

  const formatTimestamp = (ts) => {
    if (!ts || !ts.seconds) return '—';
    const date = new Date(ts.seconds * 1000);
    return date.toLocaleString();
  };

  const studentsLastLoadedText = studentsLastLoadedAt
    ? new Date(studentsLastLoadedAt).toLocaleString()
    : 'not updated yet';
  const paymentsLastLoadedText = paymentsLastLoadedAt
    ? new Date(paymentsLastLoadedAt).toLocaleString()
    : 'not updated yet';
  const otherPaymentsLastLoadedText = otherPaymentsLastLoadedAt
    ? new Date(otherPaymentsLastLoadedAt).toLocaleString()
    : 'not updated yet';
  const otherPaymentsReady = otherPaymentsLoaded || Boolean(otherPaymentsError);
  const dataLoaded = studentsLoaded && paymentsLoaded && otherPaymentsReady;
  const dataLoading = studentsLoading || paymentsLoading || otherPaymentsLoading;

  const handleRefreshData = async () => {
    try {
      await Promise.all([
        refreshStudents(),
        refreshPayments(),
        loadOtherPayments({ force: true }),
      ]);
    } catch (err) {
      // The shared data context exposes the error in the status message below.
      console.error('Failed to refresh payment history data:', err);
    }
  };

  return (
    <div className="payment-history-page">
      <h2 className="history-title">💳 PAYMENT HISTORY</h2>
      <RefreshStatus
        message={dataLoaded
          ? `Last updated — Students: ${studentsLastLoadedText}; Group payments: ${paymentsLastLoadedText}; Other payments: ${otherPaymentsLastLoadedText}`
          : 'Not updated yet'}
        error={(studentsError || paymentsError || otherPaymentsError)
          ? [
              studentsError ? `Students: ${studentsError}` : '',
              paymentsError ? `Group payments: ${paymentsError}` : '',
              otherPaymentsError ? `Other payments: ${otherPaymentsError}` : '',
            ].filter(Boolean).join(' · ')
          : ''}
        loading={dataLoading}
        onRefresh={handleRefreshData}
        refreshLabel="Refresh data"
      />
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
          <li
            key={`${p.paymentKind}-${p.id}`}
            className="transaction-card transaction-card-link"
            role="link"
            tabIndex={0}
            onClick={() => navigate(getPaymentDetailPath(p))}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                navigate(getPaymentDetailPath(p));
              }
            }}
          >
            <div className="top-line">
              <div className="transaction-summary">
                <div className="info"><b>Student:</b> {getStudentName(p.studentId)}</div>
                <span className="date">{p.createdAt}</span>
              </div>
              <span className="amountSum">+{p.amount}€</span>
            </div>
            <div className="info">
              <div><b>Paid by:</b> {getPaymentMethodLabel(p.paymentMethod)}</div>
              {p.paymentKind === 'other' ? (
                <div><b>Reason:</b> {getOtherPaymentReasonLabel(p.reason)}</div>
              ) : (
                <>
                  <div><b>Classes:</b> {p.type}</div>
                  <div><b>Groups:</b> {getGroupNames(p.groups)}</div>
                </>
              )}
              <div><b>Date from:</b> {p.dateFrom}{p.timeFrom ? ` ${p.timeFrom}` : ''}</div>
              {p.paymentKind !== 'other' && <div><b>Discount:</b> {p.discount}%</div>}
              <div><b>Timestamp:</b> {formatTimestamp(p.timestamp)}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default PaymentHistoryPage;
