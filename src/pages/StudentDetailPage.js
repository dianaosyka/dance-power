import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  collection,
  getDocs,
  query,
  deleteDoc,
  doc,
  getDoc
} from 'firebase/firestore';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import './StudentDetailPage.css';

function getCombinedClassDates({ groups, payment, canceledMap }) {
  const [dd, mm, yyyy] = payment.dateFrom.split('.').map(Number);
  let date = new Date(yyyy, mm - 1, dd);

  const results = [];

  while (results.length < payment.type) {
    for (const groupId of payment.groups) {
      const group = groups.find(g => g.id === groupId);
      if (!group || date.getDay() !== group.dayOfWeek) continue;

      const openingDate = new Date(group.openingDate.split('.').reverse().join('-'));
      if (date < openingDate) continue;

      const dateStr = `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
      if (!canceledMap[groupId]?.includes(dateStr)) {
        results.push({ date: dateStr, groupId, groupName: group.name });
        if (results.length >= payment.type) break;
      }
    }
    date.setDate(date.getDate() + 1);
  }

  return results;
}

function StudentDetailPage() {
  const { studentId } = useParams();
  const { db, students, payments, groups } = useData();
  const { user } = useUser();
  const navigate = useNavigate();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [canceledMap, setCanceledMap] = useState({});
  const [absences, setAbsences] = useState({});
  const [classes, setClasses] = useState([]);

  const student = students.find(s => s.id === studentId);
  const studentPayments = payments
    .filter(p => p.studentId === studentId)
    .sort((a, b) => {
      const [da, ma, ya] = a.dateFrom.split('.');
      const [db, mb, yb] = b.dateFrom.split('.');
      const dateA = new Date(`${ya}-${ma}-${da}`);
      const dateB = new Date(`${yb}-${mb}-${db}`);
      return dateB - dateA;
    });

  const currentPayment = studentPayments[currentIndex];

  useEffect(() => {
    if (!currentPayment) return;

    const fetchCanceled = async () => {
      const map = {};
      for (const groupId of currentPayment.groups) {
        const q = query(collection(db, `groups/${groupId}/canceledClasses`));
        const snap = await getDocs(q);
        map[groupId] = snap.docs.map(d => d.data().date);
      }
      setCanceledMap(map);
    };

    fetchCanceled();
  }, [currentPayment, db]);

  useEffect(() => {
    const fetchAbsences = async () => {
      const ref = doc(db, 'students', studentId);
      const snap = await getDoc(ref);
      const data = snap.exists() ? snap.data().absences || {} : {};
      setAbsences(data);
    };

    if (studentId) {
      fetchAbsences();
    }
  }, [studentId]);

  useEffect(() => {
    if (!currentPayment) return;

    const allDates = getCombinedClassDates({
      groups,
      payment: currentPayment,
      canceledMap,
    });

    setClasses(allDates);
  }, [currentPayment, canceledMap, groups]);

  if (!student) return <div>Loading...</div>;

  const getAttendanceIcon = (groupId, date) => {
    const today = new Date();
    const [dd, mm, yyyy] = date.split('.').map(Number);
    const classDate = new Date(yyyy, mm - 1, dd);
    if (classDate > today) return '🕒';
    const absentGroups = absences?.[date] || [];
    return absentGroups.includes(groupId) ? '❌' : '✅';
  };

  const handleDelete = async () => {
    if (window.confirm('Are you sure you want to delete this payment?')) {
      try {
        await deleteDoc(doc(db, 'payments', currentPayment.id));
        alert('✅ Payment deleted');
      } catch (err) {
        alert('❌ Error deleting payment');
        console.error(err);
      }
    }
  };

  const handleDeleteStudent = async () => {
    const first = window.confirm('Are you sure you want to delete this student?');
    if (!first) return;

    const second = prompt('⚠️ This action is permanent.\nType DELETE to confirm.');
    if (second !== 'DELETE') {
      alert('❌ Deletion canceled');
      return;
    }

    try {
      await deleteDoc(doc(db, 'students', studentId));
      alert('✅ Student deleted');
      navigate('/students');
    } catch (err) {
      alert('❌ Error deleting student');
      console.error(err);
    }
  };

  const handleAddPayment = () => {
    navigate(`/add-payment?studentName=${encodeURIComponent(student.name)}`);
  };

  if (studentPayments.length === 0) {
    return (
      <div>
        <div className="student-card">
          {(user?.role === 'admin' || user?.role === 'coach') && (<p>{student.id}</p>)}
          <p>{student.phone}</p>
          <h2>{student.name.toUpperCase()}</h2>
          <h3>No memberships.</h3>
        </div>

        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <button onClick={handleAddPayment} style={{ padding: '8px 16px' }}>➕ Add Payment</button>
        </div>

        {user?.role === 'admin' && (
          <div style={{ marginTop: '30px', textAlign: 'center' }}>
            <button
              onClick={handleDeleteStudent}
              style={{
                backgroundColor: 'red',
                color: 'white',
                padding: '8px 16px',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer'
              }}
            >
              🗑 DELETE STUDENT
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="student-card">
        {(user?.role === 'admin' || user?.role === 'coach') && (<p>{student.id}</p>)}
        <p>{student.phone}</p>
        <h2>{student.name.toUpperCase()}</h2>
        {currentPayment.createdAt && <p>PAYMENT DATE: {currentPayment.createdAt}</p>}
        <p>START DATE: {currentPayment.dateFrom}</p>
        <h1 className="price">{currentPayment.amount}€</h1>

        <div className="group-list">
          GROUPS:
          {currentPayment.groups.map(gid => {
            const g = groups.find(gr => gr.id === gid);
            return <div key={gid}>{g?.name}</div>;
          })}
        </div>

        <h3 className="amount">CLASSES AMOUNT: {currentPayment.type}</h3>
        <h5 className="warning">*the class dates may differ due to rescheduling.</h5>

        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>DATE</th>
              <th>GROUP</th>
              <th>ATTENDED</th>
            </tr>
          </thead>
          <tbody>
            {classes.map((c, index) => (
              <tr key={index}>
                <td>{index + 1}</td>
                <td>{c.date}</td>
                <td>{c.groupName}</td>
                <td>{getAttendanceIcon(c.groupId, c.date)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {user?.role === 'admin' && (
          <div className="delete-button">
            <button onClick={handleDelete}>🗑</button>
          </div>
        )}

        <div className="swipe-controls">
          {currentIndex < studentPayments.length - 1 && (
            <button onClick={() => setCurrentIndex(currentIndex + 1)}>← Prev</button>
          )}
          {currentIndex > 0 && (
            <button onClick={() => setCurrentIndex(currentIndex - 1)}>Next →</button>
          )}
        </div>
      </div>
      {user?.role === 'admin' && (
        <div>
      <div style={{ textAlign: 'center', marginTop: '20px' }}>
        <button onClick={handleAddPayment} style={{ padding: '8px 16px' }}>➕ ADD PAYMENT</button>
      </div>

      <div style={{ marginTop: '10px', textAlign: 'center' }}>
          <button
            onClick={handleDeleteStudent}
            style={{ background:'red'}}
          >
            DELETE STUDENT
          </button>
        </div>
        </div>
      )}
    </div>
  );
}

export default StudentDetailPage;
