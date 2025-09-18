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

function getTodayDate() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

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
  const [startDate, setStartDate] = useState(getTodayDate());
  const [paidDate, setPaidDate] = useState(getTodayDate());
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false); // <-- prevent double-clicks

  const filteredStudents = students.filter(s =>
    s.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleGroup = (id) => {
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

    if (
      !selectedStudent ||
      !amount ||
      !type ||
      !startDate ||
      !paidDate ||
      selectedGroups.length === 0
    ) {
      alert('Please fill in all fields');
      return;
    }

    const amountNum = parseFloat(String(amount).replace(',', '.'));
    const typeNum = parseInt(String(type), 10);
    const discountNum = parseFloat(String(discount));

    if (
      Number.isNaN(amountNum) ||
      Number.isNaN(typeNum) ||
      typeNum <= 0 ||
      Number.isNaN(discountNum)
    ) {
      alert('Please enter valid numbers for amount/type/discount');
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
      setStartDate(getTodayDate());
      setPaidDate(getTodayDate());
      setSelectedGroups([]);

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

      <div className="form-row">
        <label>WHO:</label>
        <input
          placeholder="Search student"
          value={searchTerm}
          onChange={e => {
            setSearchTerm(e.target.value);
            setSelectedStudent(null);
          }}
          className="input"
        />
        {searchTerm && !selectedStudent && (
          <ul className="dropdown">
            {filteredStudents.map(s => (
              <li
                key={s.id}
                onClick={() => {
                  setSelectedStudent(s);
                  setSearchTerm(s.name);
                }}
              >
                {s.name}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="form-row">
        <label>AMOUNT (€):</label>
        <input
          className="input"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          inputMode="decimal"
        />
      </div>

      <div className="form-row">
        <label>PAYMENT DATE:</label>
        <input
          type="date"
          className="input"
          value={paidDate}
          onChange={e => setPaidDate(e.target.value)}
        />
      </div>

      <div className="form-row">
        <label>DATE FROM:</label>
        <input
          type="date"
          className="input"
          value={startDate}
          onChange={e => setStartDate(e.target.value)}
        />
      </div>

      <div className="form-row">
        <label>TYPE:</label>
        <select
          className="input"
          value={type}
          onChange={e => setType(e.target.value)}
        >
          <option value="">Select...</option>
          {[1, 2, 4, 8, 12, 24].map((num) => (
            <option key={num} value={num}>
              {num} CLASSES
            </option>
          ))}
        </select>
      </div>

      <div className="form-row">
        <label>GROUPS:</label>
        <div className="group-box">
          {groups.map(group => (
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

      <div className="form-row">
        <label>DISCOUNT (%):</label>
        <input
          className="input"
          value={discount}
          onChange={e => setDiscount(e.target.value)}
          placeholder="0"
          inputMode="decimal"
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
