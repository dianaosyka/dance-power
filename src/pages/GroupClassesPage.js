import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  collection,
  getDocs,
  doc,
  runTransaction,
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
  const { groups, db, coaches } = useData();
  const { user } = useUser();

  const [group, setGroup] = useState(null);
  const [pastDates, setPastDates] = useState([]);
  const [futureDates, setFutureDates] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [showFuture, setShowFuture] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);

  const [newDate, setNewDate] = useState('');
  const [newRent, setNewRent] = useState(15);
  const [newCanceled, setNewCanceled] = useState(false);
  const [newCoach, setNewCoach] = useState('');

  // guards
  const [isToggling, setIsToggling] = useState(false);
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    const g = groups.find(g => g.id === groupId);
    setGroup(g);
  }, [groupId, groups]);

  useEffect(() => {
    const fetchPastClasses = async () => {
      if (!groupId) return;
      const snap = await getDocs(collection(db, `groups/${groupId}/pastClasses`));
      const fetched = snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
    if (!selectedDate || !groupId || isToggling) return;

    setIsToggling(true);
    const ref = doc(db, `groups/${groupId}/pastClasses`, selectedDate);

    try {
      // Atomic flip on the server to avoid race/double-click
      const newStatus = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) {
          throw new Error('Class document does not exist.');
        }
        const current = !!snap.data().canceled;
        tx.update(ref, {
          canceled: !current,
          timestamp: Timestamp.now(),
        });
        return !current;
      });

      // Reflect locally
      setPastDates(prev =>
        prev.map(p =>
          p.date === selectedDate ? { ...p, canceled: newStatus } : p
        )
      );
    } catch (err) {
      console.error('Error toggling canceled status:', err);
      alert('❌ Failed to toggle class status.');
    } finally {
      setIsToggling(false);
      setShowModal(false);
      setSelectedDate(null);
    }
  };

  const handleAddClass = async () => {
    if (isAdding) return;
    if (!groupId || !newDate || !newCoach) {
      alert('Please fill in all fields');
      return;
    }

    const [yyyy, mm, dd] = newDate.split('-');
    const formattedDate = `${dd}.${mm}.${yyyy}`;
    const ref = doc(db, `groups/${groupId}/pastClasses`, formattedDate);

    setIsAdding(true);
    try {
      // Create only if not exists (atomic)
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists()) {
          throw new Error('This class date already exists.');
        }
        tx.set(ref, {
          date: formattedDate,
          coach: [newCoach],
          rent: Number(newRent),
          canceled: Boolean(newCanceled),
          timestamp: Timestamp.now(),
        });
      });

      // Optionally refresh list immediately (or keep navigate)
      // Navigate back to list
      setShowAddForm(false);
      setNewDate('');
      setNewRent(15);
      setNewCanceled(false);
      setNewCoach('');
      navigate(`/groups`);
    } catch (err) {
      console.error(err);
      alert(`❌ Error adding class: ${err.message || 'Unknown error'}`);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="group-page">
      <h2 className="group-title">{group?.name?.toUpperCase()}</h2>
      <p className="group-schedule">{group?.schedule || 'FRIDAY 20:00'}</p>

      {user?.role === 'admin' && (
        <>
          <button className="students-button" onClick={() => navigate('/students')}>
            STUDENTS LIST
          </button>
          <button
            className="add-cancel-button"
            onClick={() => setShowAddForm(true)}
            style={{ backgroundColor: 'green', color: 'white', marginBottom: 10 }}
          >
            ➕ ADD CLASS
          </button>
        </>
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
                if (isToggling) return;
                setSelectedDate(past.date);
                setShowModal(true);
              }}
              title={isToggling ? 'Working…' : (past.canceled ? 'Uncancel' : 'Cancel')}
              style={{ opacity: isToggling ? 0.6 : 1, pointerEvents: isToggling ? 'none' : 'auto' }}
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
              <button onClick={() => setShowModal(false)} disabled={isToggling}>No</button>
              <button onClick={handleToggleCancel} disabled={isToggling}>
                {isToggling ? 'Working…' : 'Yes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddForm && (
        <div className="modal-overlay">
          <div className="modal-box">
            <h3>➕ ADD NEW PAST CLASS</h3>
            <input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              disabled={isAdding}
            />
            <input
              type="number"
              placeholder="Rent (€)"
              value={newRent}
              onChange={(e) => setNewRent(e.target.value)}
              disabled={isAdding}
            />
            <select
              value={newCoach}
              onChange={(e) => setNewCoach(e.target.value)}
              disabled={isAdding}
            >
              <option value="">Select coach</option>
              {coaches?.map((coach) => (
                <option key={coach.id} value={coach.id}>
                  {coach.email}
                </option>
              ))}
            </select>

            <label style={{ marginTop: '10px' }}>
              <input
                type="checkbox"
                checked={newCanceled}
                onChange={(e) => setNewCanceled(e.target.checked)}
                disabled={isAdding}
              />
              Canceled
            </label>
            <div className="modal-buttons">
              <button onClick={() => setShowAddForm(false)} disabled={isAdding}>Cancel</button>
              <button onClick={handleAddClass} disabled={isAdding}>
                {isAdding ? 'Adding…' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default GroupClassesPage;
