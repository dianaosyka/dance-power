import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  collection,
  getDocs,
  query,
} from 'firebase/firestore';
import { useData } from '../context/DataContext';
import './StudentDetailPage.css';

function getNextClassDates({ dayOfWeek, startDate, count, canceledDates }) {
  const results = [];
  let date = new Date();

  const [dd, mm] = startDate.split('.');
  date = new Date(new Date().getFullYear(), parseInt(mm) - 1, parseInt(dd));

  while (results.length < count) {
    if (date.getDay() === dayOfWeek) {
      const dateStr = `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!canceledDates.includes(dateStr)) {
        results.push(dateStr);
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
    const fetchCanceled = async () => {
      const map = {};
      for (const groupId of currentPayment.groups) {
        const q = query(collection(db, `groups/${groupId}/canceledClasses`));
        const snap = await getDocs(q);
        map[groupId] = snap.docs.map(d => d.data().date);
      }
      setCanceledMap(map);
    };

    if (currentPayment) {
      fetchCanceled();
    }
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

    const allDates = [];

    currentPayment.groups.forEach(groupId => {
      const group = groups.find(g => g.id === groupId);
      if (!group) return;

      const canceled = canceledMap[groupId] || [];
      const dates = getNextClassDates({
        dayOfWeek: group.dayOfWeek,
        startDate: currentPayment.dateFrom,
        count: currentPayment.type,
        canceledDates: canceled,
      });

      dates.forEach(date =>
        allDates.push({ date, groupId, groupName: group.name })
      );
    });

    allDates.sort((a, b) => {
      const [d1, m1] = a.date.split('.').map(Number);
      const [d2, m2] = b.date.split('.').map(Number);
      return new Date(2025, m1 - 1, d1) - new Date(2025, m2 - 1, d2);
    });

    setClasses(allDates.slice(0, currentPayment.type));
  }, [currentPayment, canceledMap, groups]);

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

  if (!student || !currentPayment) return <div>Loading...</div>;

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
              <td>1</td>
              <td>{c.date}</td>
              <td>{c.groupName}</td>
              <td>{getAttendanceIcon(c.groupId, c.date)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="delete-button">
        <button>🗑</button>
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
