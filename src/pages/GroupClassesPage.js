import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  Timestamp
} from 'firebase/firestore';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import './GroupClassesPage.css';

function getNextFutureDates(startFrom, weekday, count) {
  const result = [];
  const date = new Date(startFrom);

  while (result.length < count) {
    if (date.getDay() === weekday) {
      const dd = String(date.getDate()).padStart(2, '0');
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const yyyyStr = date.getFullYear();
      result.push(`${dd}.${mm}.${yyyyStr}`);
    }
    date.setDate(date.getDate() + 1);
  }

  return result;
}

function parseDateStr(dateStr) {
  const [dd, mm, yyyy] = dateStr.split('.').map(Number);
  return new Date(yyyy, mm - 1, dd);
}

function GroupClassesPage() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const { groups, db } = useData();
  const { user } = useUser();

  const [group, setGroup] = useState(null);
  const [pastDates, setPastDates] = useState([]);
  const [futureDates, setFutureDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [showFuture, setShowFuture] = useState(false);

  useEffect(() => {
    const g = groups.find(g => g.id === groupId);
    setGroup(g);
  }, [groupId, groups]);

  useEffect(() => {
    const fetchPastClasses = async () => {
      if (!groupId) return;
      const snap = await getDocs(collection(db, `groups/${groupId}/pastClasses`));
      const fetched = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      fetched.sort((a, b) => parseDateStr(b.date) - parseDateStr(a.date));
      setPastDates(fetched);
    };

    fetchPastClasses();
  }, [groupId, db]);

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

  const handleToggleCancel = async () => {
    if (!selectedDate || !groupId) return;

    const ref = doc(db, `groups/${groupId}/pastClasses`, selectedDate);
    const current = pastDates.find(p => p.date === selectedDate);
    const newStatus = !(current?.canceled ?? false);

    try {
      await updateDoc(ref, {
        canceled: newStatus,
        timestamp: Timestamp.now(),
      });

      setPastDates(prev =>
        prev.map(p =>
          p.date === selectedDate ? { ...p, canceled: newStatus } : p
        )
      );
    } catch (err) {
      console.error('Error updating canceled status:', err);
    }

    setShowModal(false);
    setSelectedDate(null);
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
              <li key={date} className="class-item">
                <span>{date}</span>
                <span className="check">🕒</span>
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
        {pastDates.map(past => (
          <li key={past.date} className="class-item">
            <span>{past.date}</span>
            <span
              className="check"
              onClick={() => {
                setSelectedDate(past.date);
                setShowModal(true);
              }}
            >
              {past.canceled ? '❌' : '✅'}
            </span>
            <span
              className="arrow"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/group/${groupId}/class/${past.date}`);
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
              {pastDates.find(p => p.date === selectedDate)?.canceled
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
