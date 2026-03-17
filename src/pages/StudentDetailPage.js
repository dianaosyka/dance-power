import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  deleteDoc,
  doc,
  getDoc,
  updateDoc
} from 'firebase/firestore';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import './StudentDetailPage.css';
import { getPaymentClasses } from '../utils/paymentsUtils';

function StudentDetailPage() {
  const { studentId } = useParams();
  const { db, students, payments, groups } = useData();
  const { user, setUser } = useUser();
  const navigate = useNavigate();

  const [currentIndex, setCurrentIndex] = useState(0);
  const [absences, setAbsences] = useState({});
  const [classes, setClasses] = useState([]);
  const [loadingClasses, setLoadingClasses] = useState(true);

  const student = students.find(s => s.id === studentId);

  const studentPayments = payments
    .filter(p => p.studentId === studentId)
    .sort((a, b) => {
      const [da, ma, ya] = (a.dateFrom || '01.01.1970').split('.');
      const [dbb, mbb, ybb] = (b.dateFrom || '01.01.1970').split('.');
      return new Date(`${ybb}-${mbb}-${dbb}`) - new Date(`${ya}-${ma}-${da}`);
    });

  const currentPayment =
    studentPayments.length > 0 ? studentPayments[currentIndex] : null;

  useEffect(() => {
    const fetchAbsences = async () => {
      try {
        const ref = doc(db, 'students', studentId);
        const snap = await getDoc(ref);
        const data = snap.exists() ? snap.data().absences || {} : {};
        setAbsences(data);
      } catch (err) {
        console.error('Error fetching absences:', err);
        setAbsences({});
      }
    };

    if (studentId) fetchAbsences();
  }, [studentId, db]);

  useEffect(() => {
    if (!currentPayment) {
      setClasses([]);
      setLoadingClasses(false);
      return;
    }

    let active = true;

    const fetchClasses = async () => {
      setLoadingClasses(true);
      try {
        const res = await getPaymentClasses({
          payment: currentPayment,
          groups,
          db,
        });

        if (active) {
          setClasses(Array.isArray(res) ? res : []);
        }
      } catch (err) {
        console.error('Error fetching payment classes:', err);
        if (active) setClasses([]);
      } finally {
        if (active) setLoadingClasses(false);
      }
    };

    fetchClasses();

    return () => {
      active = false;
    };
  }, [currentPayment, groups, db]);

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

  if (!student) return <div>Loading...</div>;

  if (!currentPayment) {
    return (
      <div>
        <div className="student-card">
          <p>{student.phone}</p>
          <h2>{student.name.toUpperCase()}</h2>
          <h3>No payments.</h3>
          <button onClick={handleAddPayment}>➕ ADD PAYMENT</button>
        </div>

        {user?.role === 'admin' && (
          <div style={{ marginTop: '10px', textAlign: 'center' }}>
            <button onClick={handleDeleteStudent} style={{ background: 'red', color: 'white' }}>
              DELETE STUDENT
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="student-card">
        <div className="top-row">
          <p>{student.phone}</p>
          {user?.role !== 'coach' && user?.role !== 'admin' && (
            <button className="close-btn" onClick={() => setUser(null)}>✕</button>
          )}
        </div>

        {(user?.role === 'admin' || user?.role === 'coach') && <p>{student.id}</p>}

        <h2>{student.name.toUpperCase()}</h2>
        {currentPayment?.createdAt && <p>PAYMENT DATE: {currentPayment.createdAt}</p>}
        <p>START DATE: {currentPayment.dateFrom}</p>
        <h1 className="price">{currentPayment.amount}€</h1>

        <div className="group-list">
          GROUPS:
          {(currentPayment.groups || []).map(gid => {
            const g = groups.find(gr => gr.id === gid);
            return <div key={gid}>{g?.name || gid}</div>;
          })}
        </div>

        <h3 className="amount">CLASSES AMOUNT: {currentPayment.type}</h3>
        <h5 className="warning">*the class dates may differ due to rescheduling.</h5>

        {loadingClasses ? (
          <p>Loading classes...</p>
        ) : (
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
              {classes.length > 0 ? (
                classes.map((c, index) => (
                  <tr key={`${c.groupId}-${c.date}-${index}`}>
                    <td>{index + 1}</td>
                    <td>{c.date}</td>
                    <td>{c.groupName}</td>
                    <td>{getAttendanceIcon(c.groupId, c.date)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="4">No classes found for this payment.</td>
                </tr>
              )}
            </tbody>
          </table>
        )}

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
            <button onClick={handleAddPayment} style={{ padding: '8px 16px' }}>
              ➕ ADD PAYMENT
            </button>
          </div>
          <div style={{ marginTop: '10px', textAlign: 'center' }}>
            <button onClick={handleDeleteStudent} style={{ background: 'red', color: 'white' }}>
              DELETE STUDENT
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default StudentDetailPage;
