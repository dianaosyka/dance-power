import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { useData } from '../context/DataContext';
import './GroupClassesPage.css';

function getLastNDatesMatchingWeekday(n, weekday) {
  const result = [];
  const today = new Date();
  let date = new Date(today);

  while (result.length < n) {
    if (date.getDay() === weekday && date <= today) {
      const dd = String(date.getDate()).padStart(2, '0');
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      result.push(`${dd}.${mm}`);
    }
    date.setDate(date.getDate() - 1);
  }
  return result;
}

function GroupClassesPage() {
  const { groupId } = useParams();
  const { groups, db } = useData();
  const [dates, setDates] = useState([]);
  const [group, setGroup] = useState(null);
  const [canceled, setCanceled] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    const g = groups.find(g => g.id === groupId);
    setGroup(g);
    if (g) {
      const weekday = g.dayOfWeek ?? 5;
      setDates(getLastNDatesMatchingWeekday(10, weekday));
    }
  }, [groupId, groups]);

  // Load canceled subcollection for this group
  useEffect(() => {
    if (!groupId) return;
    const fetchCanceled = async () => {
      const q = query(collection(db, `groups/${groupId}/canceledClasses`));
      const snap = await getDocs(q);
      setCanceled(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    };
    fetchCanceled();
  }, [groupId, db]);

  const isCanceled = (dateStr) =>
    canceled.some(doc => doc.date === dateStr);

  const handleToggleCancel = async () => {
    if (!selectedDate) return;

    const existing = canceled.find(c => c.date === selectedDate);
    const colRef = collection(db, `groups/${groupId}/canceledClasses`);

    if (existing) {
      // Uncancel → delete doc
      await deleteDoc(doc(colRef, existing.id));
      setCanceled(prev => prev.filter(c => c.id !== existing.id));
    } else {
      // Cancel → add new doc with date
      const ref = await addDoc(colRef, { date: selectedDate });
      setCanceled(prev => [...prev, { id: ref.id, date: selectedDate }]);
    }

    setShowModal(false);
    setSelectedDate(null);
  };

  return (
    <div className="group-page">
      <h2 className="group-title">{group?.name.toUpperCase()}</h2>
      <p className="group-schedule">{group?.schedule || 'FRIDAY 20:00'}</p>

      <button className="students-button">STUDENTS LIST</button>

      <h3 className="classes-heading">CLASSES</h3>
      <div className="classes-header">
        <span>CLASSES DATE</span>
        <span>IS COMPLETED</span>
        <span>SEE MORE</span>
      </div>

      <ul className="class-list">
        {dates.map(date => (
          <li
            key={date}
            className="class-item"
            onClick={() => {
              setSelectedDate(date);
              setShowModal(true);
            }}
          >
            <span>{date}</span>
            <span className="check">{isCanceled(date) ? '❌' : '✅'}</span>
            <span className="arrow">{'>'}</span>
          </li>
        ))}
      </ul>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-box">
            <p>
              {isCanceled(selectedDate)
                ? 'Uncancel this class?'
                : 'Cancel this class?'}
            </p>
            <div className="modal-buttons">
              <button onClick={() => setShowModal(false)}>No</button>
              <button onClick={handleToggleCancel}>Yes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GroupClassesPage;
