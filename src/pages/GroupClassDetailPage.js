import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  collection,
  getDocs,
  query,
} from 'firebase/firestore';
import { useData } from '../context/DataContext';
import './GroupClassDetailPage.css';

function generateClassDates(startDateStr, weekday, count, canceled) {
  const result = [];
  const [dd, mm, yyyy] = startDateStr.split('.').map(Number);
  let date = new Date(yyyy, mm - 1, dd);
  const canceledSet = new Set(canceled);

  while (result.length < count) {
    if (date.getDay() === weekday) {
      const str = `${String(date.getDate()).padStart(2, '0')}.${String(
        date.getMonth() + 1
      ).padStart(2, '0')}`;
      if (!canceledSet.has(str)) result.push(str);
    }
    date.setDate(date.getDate() + 1);
  }

  return result;
}

function GroupClassDetailPage() {
  const { groupId, date } = useParams(); // e.g. groupId and "02.06"
  const { db, groups, payments, students } = useData();
  const [group, setGroup] = useState(null);
  const [canceled, setCanceled] = useState([]);
  const [signedUp, setSignedUp] = useState([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const g = groups.find(g => g.id === groupId);
    setGroup(g);
  }, [groupId, groups]);

  useEffect(() => {
    if (!groupId) return;
    const fetchCanceled = async () => {
      const q = query(collection(db, `groups/${groupId}/canceledClasses`));
      const snap = await getDocs(q);
      const canceledList = snap.docs.map(d => d.data().date);
      setCanceled(canceledList);
    };
    fetchCanceled();
  }, [groupId, db]);

  useEffect(() => {
    if (!group || canceled.length === 0) return;

    const matched = [];

    for (const payment of payments) {
      if (!payment.groups.includes(groupId)) continue;

      const classes = generateClassDates(
        payment.dateFrom,
        group.dayOfWeek,
        payment.type,
        canceled
      );

      if (classes.includes(date)) {
        const student = students.find(s => s.id === payment.studentId);
        const perClass = payment.amount / payment.type;
        matched.push({ name: student?.name, amount: perClass.toFixed(2) });
      }
    }

    setSignedUp(matched);

    const earned = matched.reduce((sum, s) => sum + parseFloat(s.amount), 0) - 15;
    setTotal(earned.toFixed(2));
  }, [group, canceled, payments, students, date]);

  if (!group) return <div>Loading...</div>;

  return (
    <div className="class-detail-page">
      <h2>{group.name.toUpperCase()}</h2>
      <p>{date}</p>
      <h3>EARNED:</h3>
      <h1 style={{ fontSize: '36px' }}>{total}€</h1>

      <h3>PEOPLE</h3>
      <div className="classes-header">
        <span>PERSON</span>
        <span>IS PAYED</span>
        <span>SEE MORE</span>
      </div>

      <ul className="student-list">
        {signedUp.map((s, i) => (
          <li key={i} className="class-item">
            <span>1 {s.name?.slice(0, 18)}...</span>
            <span>{s.amount}€</span>
            <span>{'>'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default GroupClassDetailPage;
