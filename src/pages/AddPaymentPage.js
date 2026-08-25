import React, { useEffect, useRef, useState } from 'react';
import { useData } from '../context/firebase';
import {
  collection,
  Timestamp,
  doc,
  arrayUnion,
  writeBatch, // <-- atomic writes
} from 'firebase/firestore';
import { useNavigate, useLocation } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import { invalidateSalarySummaries } from '../utils/salaryCache';
import {
  formatEuropeanDate,
  getOtherPaymentMonth,
  OTHER_PAYMENT_REASONS,
} from '../utils/otherPaymentsUtils';
import { invalidateOtherPaymentHistory } from '../utils/otherPaymentsCache';
import { PAYMENT_METHODS } from '../utils/paymentMethodUtils';
import RefreshStatus from '../components/RefreshStatus';
import './AddPaymentPage.css';

function AddPaymentPage() {
  const {
    students,
    groups,
    db,
    studentsLoaded,
    studentsLoading,
    studentsError,
    studentsLastLoadedAt,
    refreshStudents,
    upsertPayment,
    patchStudent,
  } = useData();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useUser();
  const isCoach = user?.role === 'coach';

  const [paymentMode, setPaymentMode] = useState('group');
  const [paymentMethod, setPaymentMethod] = useState(isCoach ? 'cash' : 'card');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [amount, setAmount] = useState('');
  const [type, setType] = useState('');
  const [discount, setDiscount] = useState('0');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [paidDate, setPaidDate] = useState('');
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false); // <-- prevent double-clicks
  const [errors, setErrors] = useState({});
  const appliedPrefillQuery = useRef(null);
  const submissionInProgress = useRef(false);

  useEffect(() => {
    if (!isCoach) return;
    setPaymentMode('group');
    setPaymentMethod('cash');
  }, [isCoach]);

  const clearError = (field) => {
    setErrors(current => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const filteredStudents = students.filter(s =>
    String(s.name || '').toLowerCase().includes(searchTerm.toLowerCase())
  );
  const sortedGroups = groups
    .filter(group => group.hidden !== true)
    .sort((b, a) => a.name.localeCompare(b.name));

  const toggleGroup = (id) => {
    clearError('groups');
    setSelectedGroups(prev =>
      prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]
    );
  };

  // Prefer the stable student ID, while retaining support for older name links.
  useEffect(() => {
    if (!studentsLoaded || appliedPrefillQuery.current === location.search) return;

    const params = new URLSearchParams(location.search);
    const studentIdFromURL = params.get('studentId');
    const nameFromURL = params.get('studentName');
    const paymentModeFromURL = params.get('mode');
    appliedPrefillQuery.current = location.search;

    if (!isCoach && paymentModeFromURL === 'other') {
      setPaymentMode('other');
    }

    if (!studentIdFromURL && !nameFromURL) return;

    const match = studentIdFromURL
      ? students.find(s => s.id === studentIdFromURL)
      : students.find(s => s.name === nameFromURL);

    if (match) {
      setSearchTerm(match.name);
      setSelectedStudent(match);
    } else if (nameFromURL) {
      setSearchTerm(nameFromURL);
    }
  }, [isCoach, students, studentsLoaded, location.search]);

  const handleRefreshStudents = async () => {
    try {
      await refreshStudents();
    } catch (err) {
      // The context keeps the user-facing error for the status message below.
      console.error('Failed to refresh students for payment form:', err);
    }
  };

  const handleSubmit = async () => {
    if (submissionInProgress.current || !studentsLoaded || studentsLoading) return;

    const nextErrors = {};
    const isOtherPayment = !isCoach && paymentMode === 'other';
    if (!selectedStudent) nextErrors.student = 'Select a student from the list.';
    if (!amount) nextErrors.amount = 'Amount is required.';
    if (!startDate) nextErrors.startDate = 'Start date is required.';
    if (!paidDate) nextErrors.paidDate = 'Payment date is required.';
    if (isOtherPayment) {
      if (!reason) nextErrors.reason = 'Select a payment reason.';
    } else {
      if (!type) nextErrors.type = 'Select the number of classes.';
      if (selectedGroups.length === 0) nextErrors.groups = 'Select at least one group.';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const amountNum = parseFloat(String(amount).replace(',', '.'));
    const typeNum = isOtherPayment ? null : parseInt(String(type), 10);
    const discountNum = isOtherPayment
      ? 0
      : parseFloat(String(discount || '0').replace(',', '.'));

    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      nextErrors.amount = 'Enter a valid amount greater than zero.';
    }
    if (!isOtherPayment && (Number.isNaN(typeNum) || typeNum <= 0)) {
      nextErrors.type = 'Select a valid type.';
    }
    if (!isOtherPayment && Number.isNaN(discountNum)) {
      nextErrors.discount = 'Enter a valid discount.';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    submissionInProgress.current = true;
    setIsSubmitting(true);
    try {
      const batch = writeBatch(db);
      const timestamp = Timestamp.now();
      const commonPaymentData = {
        studentId: selectedStudent.id,
        amount: amountNum,
        dateFrom: formatEuropeanDate(startDate),
        createdAt: formatEuropeanDate(paidDate),
        timestamp,
        status: 'active',
        paymentMethod: isCoach ? 'cash' : paymentMethod,
      };

      let paymentData;
      let savedPaymentId;
      if (isOtherPayment) {
        savedPaymentId = doc(collection(db, 'otherpayments')).id;
        const month = getOtherPaymentMonth(commonPaymentData.dateFrom);
        paymentData = {
          ...commonPaymentData,
          reason,
          paymentKind: 'other',
        };
        batch.set(doc(db, 'otherpayments', month), {
          month,
          updatedAt: timestamp,
          payments: {
            [savedPaymentId]: paymentData,
          },
        }, { merge: true });
      } else {
        const paymentRef = doc(collection(db, 'payments'));
        savedPaymentId = paymentRef.id;
        paymentData = {
          ...commonPaymentData,
          type: typeNum,
          discount: discountNum,
          groups: selectedGroups,
          ...(startTime ? { timeFrom: startTime } : {}),
        };
        batch.set(paymentRef, paymentData);
        batch.update(doc(db, 'students', selectedStudent.id), {
          groups: arrayUnion(...selectedGroups),
          lastPaymentId: savedPaymentId,
        });
      }

      await batch.commit(); // all-or-nothing

      if (!isOtherPayment) {
        upsertPayment({ id: savedPaymentId, ...paymentData });
        patchStudent(selectedStudent.id, currentStudent => ({
          groups: [...new Set([...(currentStudent.groups || []), ...selectedGroups])],
          lastPaymentId: savedPaymentId,
        }));
      }
      if (isOtherPayment) invalidateOtherPaymentHistory();
      invalidateSalarySummaries();

      // Reset form
      setSearchTerm('');
      setSelectedStudent(null);
      setAmount('');
      setType('');
      setDiscount('0');
      setStartDate('');
      setStartTime('');
      setPaidDate('');
      setSelectedGroups([]);
      setReason('');
      setErrors({});

      const requestedReturnPath = new URLSearchParams(location.search).get('returnTo');
      const safeReturnPath = requestedReturnPath?.startsWith('/student/')
        ? requestedReturnPath
        : '';
      navigate(
        isOtherPayment
          ? safeReturnPath || '/payment-history'
          : `/student/${paymentData.studentId}`
      );
    } catch (err) {
      console.error(err);
      alert('❌ Error saving payment. Nothing was saved.');
    } finally {
      submissionInProgress.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className="add-payment-page">
      <h2 className="title">ADD A PAYMENT</h2>

      {!isCoach && (
        <div className="payment-mode-toggle" role="group" aria-label="Payment type">
          <button
            type="button"
            className={`payment-mode-button${paymentMode === 'group' ? ' active' : ''}`}
            aria-pressed={paymentMode === 'group'}
            onClick={() => {
              setPaymentMode('group');
              setErrors({});
            }}
            disabled={isSubmitting}
          >
            Group
          </button>
          <button
            type="button"
            className={`payment-mode-button${paymentMode === 'other' ? ' active' : ''}`}
            aria-pressed={paymentMode === 'other'}
            onClick={() => {
              setPaymentMode('other');
              setErrors({});
            }}
            disabled={isSubmitting}
          >
            Other
          </button>
        </div>
      )}

      <RefreshStatus
        message={studentsLoaded
          ? students.length === 0
            ? 'No students are available'
            : studentsLastLoadedAt
              ? `Last updated: ${new Date(studentsLastLoadedAt).toLocaleString()}`
              : 'Not updated yet'
          : 'Not updated yet'}
        error={studentsError ? `Could not load students: ${studentsError}` : ''}
        loading={studentsLoading}
        onRefresh={handleRefreshStudents}
        refreshLabel={studentsError ? 'Retry students' : 'Refresh students'}
        loadingLabel={studentsError ? 'Retrying…' : 'Refreshing…'}
      />

      <div className={`form-row ${selectedStudent ? 'required-filled' : 'required-empty'}`}>
        <label>WHO:</label>
        <input
          placeholder="Search student"
          value={searchTerm}
          onChange={e => {
            setSearchTerm(e.target.value);
            setSelectedStudent(null);
          }}
          className="input"
          aria-invalid={Boolean(errors.student)}
          disabled={!studentsLoaded || studentsLoading || isSubmitting}
        />
        {searchTerm && !selectedStudent && (
          <ul className="dropdown">
            {filteredStudents.map(s => (
              <li
                key={s.id}
                onClick={() => {
                  setSelectedStudent(s);
                  setSearchTerm(s.name);
                  clearError('student');
                }}
              >
                {s.name}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={`form-row ${amount ? 'required-filled' : 'required-empty'}${errors.amount && amount ? ' has-error' : ''}`}>
        <label>AMOUNT (€):</label>
        <input
          className="input"
          value={amount}
          onChange={e => {
            setAmount(e.target.value);
            clearError('amount');
          }}
          inputMode="decimal"
          aria-invalid={Boolean(errors.amount)}
        />
      </div>

      <div className="payment-method-row">
        <span className="payment-method-label">PAID BY:</span>
        <div className="payment-mode-toggle payment-method-toggle" role="group" aria-label="Payment method">
          {PAYMENT_METHODS.map(method => {
            const disabled = isSubmitting || (isCoach && method.value !== 'cash');
            return (
              <button
                key={method.value}
                type="button"
                className={`payment-mode-button${paymentMethod === method.value ? ' active' : ''}`}
                aria-pressed={paymentMethod === method.value}
                onClick={() => setPaymentMethod(method.value)}
                disabled={disabled}
              >
                {method.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className={`form-row ${paidDate ? 'required-filled' : 'required-empty'}`}>
        <label>PAYMENT DATE:</label>
        <input
          type="date"
          className="input"
          value={paidDate}
          onChange={e => {
            setPaidDate(e.target.value);
            clearError('paidDate');
          }}
          aria-invalid={Boolean(errors.paidDate)}
        />
      </div>

      <div className={`form-row ${startDate ? 'required-filled' : 'required-empty'}`}>
        <label>DATE FROM:</label>
        <input
          type="date"
          className="input"
          value={startDate}
          onChange={e => {
            setStartDate(e.target.value);
            clearError('startDate');
          }}
          aria-invalid={Boolean(errors.startDate)}
        />
      </div>

      {paymentMode === 'other' ? (
        <div className={`form-row ${reason ? 'required-filled' : 'required-empty'}`}>
          <label>REASON:</label>
          <select
            className="input"
            value={reason}
            onChange={e => {
              setReason(e.target.value);
              clearError('reason');
            }}
            aria-invalid={Boolean(errors.reason)}
          >
            <option value="">Select...</option>
            {OTHER_PAYMENT_REASONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      ) : (
        <>
          <div className="form-row optional-field">
            <label>Time from <span>optional</span></label>
            <input
              type="time"
              className="input optional-input"
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
            />
          </div>

          <div className={`form-row ${type ? 'required-filled' : 'required-empty'}`}>
            <label>TYPE:</label>
            <select
              className="input"
              value={type}
              onChange={e => {
                setType(e.target.value);
                clearError('type');
              }}
              aria-invalid={Boolean(errors.type)}
            >
              <option value="">Select...</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 12, 24].map((num) => (
                <option key={num} value={num}>
                  {num} CLASSES
                </option>
              ))}
            </select>
          </div>

          <div className={`form-row ${selectedGroups.length > 0 ? 'required-filled' : 'required-empty'}`}>
            <label>GROUPS:</label>
            <div className="group-box" aria-invalid={Boolean(errors.groups)}>
              {sortedGroups.map(group => (
                <label key={group.id} className="group-checkbox">
                  <input
                    type="checkbox"
                    checked={selectedGroups.includes(group.id)}
                    onChange={() => toggleGroup(group.id)}
                  />
                  {group.name}
                </label>
              ))}
            </div>
          </div>

          <div className={`form-row optional-field${errors.discount ? ' has-error' : ''}`}>
            <label>Discount (%) <span>optional</span></label>
            <input
              className="input optional-input"
              value={discount}
              onChange={e => {
                setDiscount(e.target.value);
                clearError('discount');
              }}
              placeholder="0"
              inputMode="decimal"
              aria-invalid={Boolean(errors.discount)}
            />
          </div>
        </>
      )}

      <button
        className="confirm-button"
        onClick={handleSubmit}
        disabled={isSubmitting || !studentsLoaded || studentsLoading}
        title={
          isSubmitting
            ? 'Saving…'
            : !studentsLoaded || studentsLoading
              ? 'Wait for students to load'
              : 'Save payment'
        }
      >
        {isSubmitting ? 'Saving…' : studentsLoading ? 'Loading…' : '✅'}
      </button>
    </div>
  );
}

export default AddPaymentPage;
