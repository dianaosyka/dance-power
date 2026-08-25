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

const COMPACT_MONTHS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

const PAYMENT_CATEGORY_LABELS = {
  hall_rent: 'hall rent',
  private_lessons: 'private lesson',
  workshops: 'workshop',
};

function formatStudentName(value) {
  const normalizedName = String(value || 'unknown').trim().toLocaleLowerCase();

  return normalizedName.replace(
    /(^|[\s'’-])(\p{L})/gu,
    (match, boundary, letter) => `${boundary}${letter.toLocaleUpperCase()}`
  );
}

function formatSurnameFirst(value) {
  const nameParts = formatStudentName(value).split(/\s+/).filter(Boolean);
  if (nameParts.length < 2) return nameParts[0] || 'Unknown';

  return `${nameParts[nameParts.length - 1]} ${nameParts.slice(0, -1).join(' ')}`;
}

function getEuropeanDateParts(value) {
  const match = String(value || '').trim().match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;

  return { day, month };
}

function formatCompactPaymentDate(value) {
  const parts = getEuropeanDateParts(value);
  if (!parts) return String(value || '—').toLocaleLowerCase();
  return `${parts.day}. ${COMPACT_MONTHS[parts.month - 1]}`;
}

function formatShortStartDate(value) {
  const parts = getEuropeanDateParts(value);
  if (!parts) return String(value || '').toLocaleLowerCase();
  return `${parts.day}.${parts.month}.`;
}

function formatEuroAmount(value) {
  const amount = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(amount)) return `€ ${value || '0,00'}`;

  const [whole, decimals] = amount.toFixed(2).split('.');
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `€ ${groupedWhole},${decimals}`;
}

function getPaymentCategoryLabel(payment) {
  if (payment.paymentKind !== 'other') return 'payment for groups';
  return PAYMENT_CATEGORY_LABELS[payment.reason]
    || getOtherPaymentReasonLabel(payment.reason).toLocaleLowerCase();
}

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
  const canAddPayment = user?.role === 'admin' || user?.role === 'coach';
  const [sortBy, setSortBy] = useState('paymentDate');
  const [expandedPayments, setExpandedPayments] = useState(() => new Set());
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
      formatStudentName(student.name),
    ])),
    [students]
  );
  const studentDisplayNamesById = useMemo(
    () => new Map(students.map(student => [
      student.id,
      formatSurnameFirst(student.name),
    ])),
    [students]
  );
  const groupsById = useMemo(
    () => new Map(groups.map(group => [group.id, group])),
    [groups]
  );

  const getStudentName = (id) => studentNamesById.get(id) || 'Unknown';
  const getStudentDisplayName = (id) => studentDisplayNamesById.get(id) || 'Unknown';
  const getPaymentGroups = (ids) =>
    (ids || []).map(id => groupsById.get(id) || { id, name: id });
  const getGroupNames = (ids) =>
    getPaymentGroups(ids).map(group => group.name || group.id).join(', ');
  const getGroupTypes = (ids) => [
    ...new Set(getPaymentGroups(ids).map(group => group.type).filter(Boolean)),
  ].join(', ');

  const getPaymentDescription = (payment) => {
    const studentName = getStudentName(payment.studentId);
    const startDate = formatShortStartDate(payment.dateFrom);
    const startDateAndTime = [startDate, payment.timeFrom].filter(Boolean).join(' ');

    if (payment.paymentKind === 'other') {
      return [
        studentName,
        getOtherPaymentReasonLabel(payment.reason).toLocaleLowerCase(),
        startDateAndTime,
      ].filter(Boolean).join(' ');
    }

    const groupDescriptions = getPaymentGroups(payment.groups).map(group => [
      group.name || group.id,
      group.type,
    ].filter(Boolean).join(' ').toLocaleLowerCase());

    return [studentName, groupDescriptions.join(', '), startDateAndTime]
      .filter(Boolean)
      .join(' ');
  };

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
    if (!ts) return '—';
    const date = typeof ts.toDate === 'function'
      ? ts.toDate()
      : new Date(Number(ts.seconds || 0) * 1000);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString();
  };

  const togglePaymentDetails = (paymentKey) => {
    setExpandedPayments(current => {
      const next = new Set(current);
      if (next.has(paymentKey)) next.delete(paymentKey);
      else next.add(paymentKey);
      return next;
    });
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
      <div className="history-header">
        <h2 className="history-title">💳 PAYMENT HISTORY</h2>
        {canAddPayment && (
          <button
            type="button"
            className="history-add-payment"
            aria-label="Add payment"
            title="Add payment"
            onClick={() => navigate('/add-payment')}
          >
            <span className="history-add-payment-icon" aria-hidden="true">+</span>
            <span>ADD PAYMENT</span>
          </button>
        )}
      </div>
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
          <li className="transaction-card transaction-message">Loading payment history...</li>
        )}
        {dataLoaded && sortedPayments.length === 0 && (
          <li className="transaction-card transaction-message">No payments found.</li>
        )}
        {dataLoaded && sortedPayments.map((p, index) => {
          const paymentKey = `${p.paymentKind}-${p.id}`;
          const studentName = getStudentDisplayName(p.studentId);
          const paymentDescription = getPaymentDescription(p);
          const formattedAmount = formatEuroAmount(p.amount);
          const detailsId = `payment-details-${index}`;
          const isExpanded = expandedPayments.has(paymentKey);

          return (
            <li key={paymentKey} className="transaction-card">
              <button
                type="button"
                className="transaction-overview"
                onClick={() => navigate(getPaymentDetailPath(p))}
                aria-label={`Open payment for ${studentName}, ${formatCompactPaymentDate(p.createdAt)}, ${paymentDescription}, ${formattedAmount}`}
              >
                <span className="transaction-icon" aria-hidden="true">
                  <svg className="transaction-icon-glyph" viewBox="0 0 28 28" focusable="false">
                    <path d="M16.5 4.5 6.5 14.5M6.5 8.5v6h6" />
                    <path d="M20.5 15.5v7M17 19h7" />
                  </svg>
                </span>
                <span className="transaction-summary">
                  <span className="transaction-name">{studentName}</span>
                  <span className="amountSum">{formattedAmount}</span>
                  <span className="transaction-date">
                    {formatCompactPaymentDate(p.createdAt)}
                  </span>
                  <span className="transaction-description">
                    {paymentDescription}
                  </span>
                  <span className="transaction-category">
                    {getPaymentCategoryLabel(p)}
                  </span>
                </span>
              </button>

              <button
                type="button"
                className="transaction-expand"
                aria-expanded={isExpanded}
                aria-controls={detailsId}
                aria-label={`${isExpanded ? 'Hide' : 'Show'} all payment information for ${studentName}`}
                onClick={() => togglePaymentDetails(paymentKey)}
              >
                <span className="transaction-expand-icon" aria-hidden="true" />
              </button>

              {isExpanded && (
                <div className="transaction-details" id={detailsId}>
                  <dl>
                    <div>
                      <dt>paid by</dt>
                      <dd>{getPaymentMethodLabel(p.paymentMethod).toLocaleLowerCase()}</dd>
                    </div>
                    <div>
                      <dt>payment date</dt>
                      <dd>{p.createdAt || '—'}</dd>
                    </div>
                    {p.paymentKind === 'other' ? (
                      <div>
                        <dt>reason</dt>
                        <dd>{getOtherPaymentReasonLabel(p.reason).toLocaleLowerCase()}</dd>
                      </div>
                    ) : (
                      <>
                        <div>
                          <dt>classes</dt>
                          <dd>{p.type ?? '—'}</dd>
                        </div>
                        <div>
                          <dt>groups</dt>
                          <dd>{getGroupNames(p.groups).toLocaleLowerCase() || '—'}</dd>
                        </div>
                        <div>
                          <dt>class type</dt>
                          <dd>{getGroupTypes(p.groups).toLocaleLowerCase() || '—'}</dd>
                        </div>
                      </>
                    )}
                    <div>
                      <dt>date from</dt>
                      <dd>{p.dateFrom || '—'}{p.timeFrom ? ` ${p.timeFrom}` : ''}</dd>
                    </div>
                    {p.paymentKind !== 'other' && (
                      <div>
                        <dt>discount</dt>
                        <dd>{p.discount ?? 0}%</dd>
                      </div>
                    )}
                    <div>
                      <dt>timestamp</dt>
                      <dd>{formatTimestamp(p.timestamp)}</dd>
                    </div>
                  </dl>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default PaymentHistoryPage;
