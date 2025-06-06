import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  query,
  getDocs,
  Timestamp,
} from 'firebase/firestore';
import { useData } from '../context/DataContext';
import { useUser } from '../context/UserContext';
import './GroupClassesPage.css';

function getPastDatesFrom(openingDateStr, weekday) {
  const result = [];
  const today = new Date();
  const [dd, mm, yyyy] = openingDateStr.split('.');
  let date = new Date(`${yyyy}-${mm}-${dd}`);

  while (date <= today) {
    if (date.getDay() === weekday) {
      const dd = String(date.getDate()).padStart(2, '0');
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      result.unshift(`${dd}.${mm}`);
    }
    date.setDate(date.getDate() + 1);
  }

  return result;
}

function getNextFutureDates(startFrom, weekday, count) {
  const result = [];
  const date = new Date(startFrom);

  while (result.length < count) {
    if (date.getDay() === weekday) {
      const dd = String(date.getDate()).padStart(2, '0');
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      result.push(`${dd}.${mm}`);
    }
    date.setDate(date.getDate() + 1);
  }

  return result;
}

function GroupClassesPage() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const { groups, db } = useData();
  const { user } = useUser();

  const [group, setGroup] = useState(null);
  const [pastDates, setPastDates] = useState([]);
  const [futureDates, setFutureDates] = useState([]);
  const [canceled, setCanceled] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [showFuture, setShowFuture] = useState(false);

  useEffect(() => {
    const g = groups.find(g => g.id === groupId);
    setGroup(g);
    if (g?.openingDate) {
      const weekday = g.dayOfWeek ?? 5;
      setPastDates(getPastDatesFrom(g.openingDate, weekday));
    }
  }, [groupId, groups]);

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
      await deleteDoc(doc(colRef, existing.id));
      setCanceled(prev => prev.filter(c => c.id !== existing.id));
    } else {
      const ref = await addDoc(colRef, {
        date: selectedDate,
        timestamp: Timestamp.now(),
      });
      setCanceled(prev => [...prev, { id: ref.id, date: selectedDate }]);
    }

    setShowModal(false);
    setSelectedDate(null);
  };

  const toggleFutureDates = () => {
    if (!group) return;
    if (showFuture) {
      setShowFuture(false);
      return;
    }

    const weekday = group.dayOfWeek ?? 5;
    const start = new Date();
    const future = getNextFutureDates(start, weekday, 10);
    setFutureDates(future);
    setShowFuture(true);
  };

  return (
    <div className="group-page">
      <h2 className="group-title">{group?.name.toUpperCase()}</h2>
      <p className="group-schedule">{group?.schedule || 'FRIDAY 20:00'}</p>

      {user?.role === 'admin' && (
        <button className="students-button" onClick={() => navigate('/students')}>
          STUDENTS LIST
        </button>
      )}

      <button className="add-cancel-button" onClick={toggleFutureDates}>
        {showFuture ? 'Hide Future Classes' : 'See Future Classes'}
      </button>

      {showFuture && (
        <>
          <h3 className="classes-heading">FUTURE CLASSES</h3>
          <div className="classes-header">
            <span>CLASSES DATE</span>
            <span>IS COMPLETED</span>
            <span>SEE MORE</span>
          </div>
          <ul className="class-list">
            {futureDates.map(date => (
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
                <span
                  className="arrow"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/group/${groupId}/class/${date}`);
                  }}
                >➔</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="classes-heading">CLASSES</h3>
      <div className="classes-header">
        <span>CLASSES DATE</span>
        <span>IS COMPLETED</span>
        <span>SEE MORE</span>
      </div>

      <ul className="class-list">
        {pastDates.map(date => (
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
            <span
              className="arrow"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/group/${groupId}/class/${date}`);
              }}
            >
              ➔
            </span>
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
