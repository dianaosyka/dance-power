import React, { useEffect, useState } from 'react';
import { useData } from '../context/DataContext';
import {
  addDoc,
  collection,
  Timestamp,
  updateDoc,
  doc,
  arrayUnion
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

    try {
      await addDoc(collection(db, 'payments'), {
        studentId: selectedStudent.id,
        amount: parseFloat(amount.replace(',', '.')),
        type: parseInt(type),
        discount: parseFloat(discount),
        groups: selectedGroups,
        dateFrom: formatDate(startDate),
        createdAt: formatDate(paidDate),
        timestamp: Timestamp.now(),
      });

      await updateDoc(doc(db, 'students', selectedStudent.id), {
        groups: arrayUnion(...selectedGroups),
      });

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
      navigate(`/student/${selectedStudent.id}`);
    } catch (err) {
      console.error(err);
      alert('❌ Error saving payment');
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
        />
      </div>

      <button className="confirm-button" onClick={handleSubmit}>
        ✅
      </button>
    </div>
  );
}

export default AddPaymentPage;
