import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  collection,
  getDocs,
  query,
  deleteDoc,
  doc,
  getDoc,
  updateDoc
} from 'firebase/firestore';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import './StudentDetailPage.css';

function getValidClasses(payment, groups, canceledMap) {
  if (!payment || !payment.dateFrom) return [];
  const [dd, mm, yyyy] = payment.dateFrom.split('.').map(Number);
  const startDate = new Date(yyyy, mm - 1, dd);
  const results = [];

  const maxClasses = payment.type;
  const dateMap = {};

  for (const groupId of payment.groups) {
    const group = groups.find(g => g.id === groupId);
    if (!group) continue;

    const openingDate = new Date(group.openingDate.split('.').reverse().join('-'));
    const classDates = [];

    let current = new Date(startDate);
    while (classDates.length < maxClasses * 2) {
      if (current.getDay() === group.dayOfWeek && current >= openingDate) {
        const d = String(current.getDate()).padStart(2, '0');
        const m = String(current.getMonth() + 1).padStart(2, '0');
        const y = current.getFullYear();
        const fullDate = `${d}.${m}.${y}`;
        if (!canceledMap[groupId]?.includes(fullDate)) {
          classDates.push({
            date: fullDate,
            groupId,
            groupName: group.name,
          });
        }
      }
      current.setDate(current.getDate() + 1);
    }

    dateMap[groupId] = classDates;
  }

  while (results.length < maxClasses) {
    for (const groupId of payment.groups) {
      const next = dateMap[groupId]?.shift();
      if (next) results.push(next);
      if (results.length >= maxClasses) break;
    }
  }

  return results.sort((b, a) => {
    const [da, ma, ya] = a.date.split('.');
    const [db, mb, yb] = b.date.split('.');
    return new Date(`${yb}-${mb}-${db}`) - new Date(`${ya}-${ma}-${da}`);
  });
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
      return new Date(`${yb}-${mb}-${db}`) - new Date(`${ya}-${ma}-${da}`);
    });

  const currentPayment = studentPayments.length > 0 ? studentPayments[currentIndex] : null;

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
    if (studentId) fetchAbsences();
  }, [studentId]);

  useEffect(() => {
    if (!currentPayment) return;
    const validClasses = getValidClasses(currentPayment, groups, canceledMap);
    setClasses(validClasses);
  }, [currentPayment, canceledMap, groups]);

  const getAttendanceIcon = (groupId, date) => {
    const today = new Date();
    const [dd, mm, yyyy] = date.split('.').map(Number);
    const classDate = new Date(yyyy, mm - 1, dd);
    if (classDate > today) return '🕒';
    const absentGroups = absences?.[date] || [];
    return absentGroups.includes(groupId) ? '❌' : '✅';
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this payment?')) return;
    try {
      const toDelete = studentPayments[currentIndex];
      await deleteDoc(doc(db, 'payments', toDelete.id));

      const newPayments = studentPayments.filter((_, i) => i !== currentIndex);
      const latest = newPayments[0]?.id || '';
      await updateDoc(doc(db, 'students', studentId), { lastPaymentId: latest });

      alert('✅ Payment deleted');
      setCurrentIndex(0);
    } catch (err) {
      alert('❌ Error deleting payment');
      console.error(err);
    }
  };

  const handleDeleteStudent = async () => {
    if (!window.confirm('Are you sure you want to delete this student?')) return;
    const second = prompt('⚠️ Type DELETE to confirm.');
    if (second !== 'DELETE') return alert('❌ Deletion canceled');

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

  if (!student) return <div>Loading...</div>;

  if (!currentPayment) {
    return (
      <div className="student-card">
        <p>{student.phone}</p>
        <h2>{student.name.toUpperCase()}</h2>
        <h3>No payments.</h3>
        <button onClick={handleAddPayment}>➕ ADD PAYMENT</button>
      </div>
    );
  }

  return (
    <div>
      <div className="student-card">
        {(user?.role === 'admin' || user?.role === 'coach') && (<p>{student.id}</p>)}
        <p>{student.phone}</p>
        <h2>{student.name.toUpperCase()}</h2>
        {currentPayment?.createdAt && <p>PAYMENT DATE: {currentPayment.createdAt}</p>}
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
        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <button onClick={handleAddPayment} style={{ padding: '8px 16px' }}>➕ ADD PAYMENT</button>
          <div style={{ marginTop: '10px' }}>
            <button onClick={handleDeleteStudent} style={{ background: 'red', color: 'white' }}>DELETE STUDENT</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default StudentDetailPage;
