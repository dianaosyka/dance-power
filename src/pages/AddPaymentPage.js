import React, { useState } from 'react';
import { useData } from '../context/DataContext';
import { addDoc, collection, Timestamp } from 'firebase/firestore';
import './AddPaymentPage.css';

function getTodayDate() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function AddPaymentPage() {
  const { students, groups, db } = useData();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [amount, setAmount] = useState('');
  const [type, setType] = useState(12);
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

  const handleSubmit = async () => {
    if (!selectedStudent || !amount || !type || !startDate || !paidDate || selectedGroups.length === 0) {
      alert('Please fill in all fields');
      return;
    }

    try {
      await addDoc(collection(db, 'payments'), {
        studentId: selectedStudent.id,
        amount: parseFloat(amount),
        type,
        discount: parseFloat(discount),
        groups: selectedGroups,
        dateFrom: startDate,
        createdAt: paidDate,
        timestamp: Timestamp.now(),
      });
      alert('✅ Payment saved!');
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
              <li key={s.id} onClick={() => {
                setSelectedStudent(s);
                setSearchTerm(s.name);
              }}>
                {s.name}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="form-row">
        <label>AMOUNT (€):</label>
        <input className="input" value={amount} onChange={e => setAmount(e.target.value)} />
      </div>

      <div className="form-row">
        <label>DATE FROM:</label>
        <input
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
          onChange={e => setType(parseInt(e.target.value))}
        >
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

      <div className="form-row">
        <label>DATE:</label>
        <input
          className="input"
          value={paidDate}
          onChange={e => setPaidDate(e.target.value)}
        />
      </div>

      <button className="confirm-button" onClick={handleSubmit}>
        ✅
      </button>
    </div>
  );
}

export default AddPaymentPage;
