import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  collection,
  getDocs,
  query,
  deleteDoc,
  doc,
} from 'firebase/firestore';
import { useData } from '../context/DataContext';
import './StudentDetailPage.css';

function getCombinedClassDates({ groups, payment, canceledMap }) {
  const [dd, mm] = payment.dateFrom.split('.').map(Number);
  const yyyy = new Date().getFullYear();
  let date = new Date(yyyy, mm - 1, dd);

  const results = [];

  while (results.length < payment.type) {
    for (const groupId of payment.groups) {
      const group = groups.find(g => g.id === groupId);
      if (!group || date.getDay() !== group.dayOfWeek) continue;

      const openingDate = new Date(group.openingDate.split('.').reverse().join('-'));
      if (date < openingDate) continue;

      const dateStr = `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`;
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

  const [currentIndex, setCurrentIndex] = useState(0);
  const [canceledMap, setCanceledMap] = useState({});
  const [attendance, setAttendance] = useState([]);
  const [classes, setClasses] = useState([]);

  const student = students.find(s => s.id === studentId);
  const studentPayments = payments
    .filter(p => p.studentId === studentId)
    .sort((a, b) => new Date(b.dateFrom) - new Date(a.dateFrom));

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
    const fetchAttendance = async () => {
      const q = query(collection(db, `attendance/${studentId}/records`));
      const snap = await getDocs(q);
      setAttendance(snap.docs.map(doc => doc.data()));
    };

    if (studentId) {
      fetchAttendance();
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

  if (studentPayments.length === 0) {
    return (
      <div className="student-card">
        <h2>{student.name.toUpperCase()}</h2>
        <p>{student.phone}</p>
        <h3>No memberships.</h3>
      </div>
    );
  }

  const getAttendanceIcon = (groupId, date) => {
    const today = new Date();
    const [dd, mm] = date.split('.').map(Number);
    const classDate = new Date(today.getFullYear(), mm - 1, dd);

    if (classDate > today) return '🕒';

    const notAttended = attendance.some(
      a => a.date === date && a.groupId === groupId
    );

    return notAttended ? '❌' : '✅';
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

  return (
    <div className="student-card">
      <h2>{student.name.toUpperCase()}</h2>
      <p>{student.phone}</p>
      <p>DATE FROM: {currentPayment.dateFrom}</p>
      <h1 className="price">{currentPayment.amount}€</h1>
      <div className="group-list">
        GROUPS:
        {currentPayment.groups.map(gid => {
          const g = groups.find(gr => gr.id === gid);
          return <div key={gid}>{g?.name}</div>;
        })}
      </div>
      <h3>CLASSES AMOUNT: {currentPayment.type}</h3>
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

      <div className="delete-button">
        <button onClick={handleDelete}>🗑</button>
      </div>

      <div className="swipe-controls">
        {currentIndex < studentPayments.length - 1 && (
          <button onClick={() => setCurrentIndex(currentIndex + 1)}>← Prev</button>
        )}
        {currentIndex > 0 && (
          <button onClick={() => setCurrentIndex(currentIndex - 1)}>Next →</button>
        )}
      </div>
    </div>
  );
}

export default StudentDetailPage;
