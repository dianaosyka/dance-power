import React, { useEffect, useState } from 'react';
import { useData } from '../context/firebase';
import {
  collection,
  Timestamp,
  doc,
  arrayUnion,
  writeBatch, // <-- atomic writes
} from 'firebase/firestore';
import { useNavigate, useLocation } from 'react-router-dom';
import './AddPaymentPage.css';

function formatDate(dateStr) {
  const date = new Date(dateStr);
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function AddPaymentPage() {
  const { students, groups, db } = useData();
  const navigate = useNavigate();
  const location = useLocation();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [amount, setAmount] = useState('');
  const [type, setType] = useState('');
  const [discount, setDiscount] = useState('0');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [paidDate, setPaidDate] = useState('');
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false); // <-- prevent double-clicks
  const [errors, setErrors] = useState({});

  const clearError = (field) => {
    setErrors(current => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const filteredStudents = students.filter(s =>
    s.name.toLowerCase().includes(searchTerm.toLowerCase())
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

  // Prefill student from ?studentName=...
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const nameFromURL = params.get('studentName');
    if (nameFromURL) {
      setSearchTerm(nameFromURL);
      const match = students.find(s => s.name === nameFromURL);
      if (match) {
        setSelectedStudent(match);
      }
    }
  }, [students, location.search]);

  const handleSubmit = async () => {
    if (isSubmitting) return; // block double-clicks

    const nextErrors = {};
    if (!selectedStudent) nextErrors.student = 'Select a student from the list.';
    if (!amount) nextErrors.amount = 'Amount is required.';
    if (!type) nextErrors.type = 'Select the number of classes.';
    if (!startDate) nextErrors.startDate = 'Start date is required.';
    if (!paidDate) nextErrors.paidDate = 'Payment date is required.';
    if (selectedGroups.length === 0) nextErrors.groups = 'Select at least one group.';

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const amountNum = parseFloat(String(amount).replace(',', '.'));
    const typeNum = parseInt(String(type), 10);
    const discountNum = parseFloat(String(discount || '0').replace(',', '.'));

    if (Number.isNaN(amountNum)) nextErrors.amount = 'Enter a valid amount.';
    if (Number.isNaN(typeNum) || typeNum <= 0) nextErrors.type = 'Select a valid type.';
    if (Number.isNaN(discountNum)) nextErrors.discount = 'Enter a valid discount.';

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setIsSubmitting(true);
    try {
      const batch = writeBatch(db);

      // Prepare new payment doc with an ID
      const paymentRef = doc(collection(db, 'payments'));

      const paymentData = {
        studentId: selectedStudent.id,
        amount: amountNum,
        type: typeNum,
        discount: discountNum,
        groups: selectedGroups,
        dateFrom: formatDate(startDate),
        ...(startTime ? { timeFrom: startTime } : {}),
        createdAt: formatDate(paidDate),
        timestamp: Timestamp.now(),
        status: 'active',
      };

      // Atomic: set payment + update student together
      batch.set(paymentRef, paymentData);
      batch.update(doc(db, 'students', selectedStudent.id), {
        groups: arrayUnion(...selectedGroups),
        lastPaymentId: paymentRef.id,
      });

      await batch.commit(); // all-or-nothing

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
      setErrors({});

      // Go back to student detail
      navigate(`/student/${paymentData.studentId}`);
    } catch (err) {
      console.error(err);
      alert('❌ Error saving payment. Nothing was saved.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="add-payment-page">
      <h2 className="title">ADD A PAYMENT</h2>

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

      <button
        className="confirm-button"
        onClick={handleSubmit}
        disabled={isSubmitting}
        title={isSubmitting ? 'Saving…' : 'Save payment'}
      >
        {isSubmitting ? 'Saving…' : '✅'}
      </button>
    </div>
  );
}

export default AddPaymentPage;
