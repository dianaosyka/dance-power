import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, getDocs, query } from 'firebase/firestore';
import { useData } from '../context/DataContext';
import './GroupClassDetailPage.css';

function generateCombinedSchedule(payments, groups, canceled, count) {
  const allPairs = [];

  for (const payment of payments) {
    console.log(`Checking payment of ${payment.id}`);

    const [dd, mm] = payment.dateFrom.split('.').map(Number);
    const yyyy = new Date().getFullYear();
    let date = new Date(yyyy, mm - 1, dd);

    const localCanceled = {};
    payment.groups.forEach(groupId => {
      localCanceled[groupId] = canceled[groupId] || [];
    });

    while (allPairs.length < count) {
      for (const groupId of payment.groups) {
        const group = groups.find(g => g.id === groupId);
        if (!group || date.getDay() !== group.dayOfWeek) continue;

        const openingDate = new Date(group.openingDate.split('.').reverse().join('-'));
        if (date < openingDate) continue;

        const dateStr = `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (!localCanceled[groupId].includes(dateStr)) {
          allPairs.push({ date: dateStr, groupId, payment });
          if (allPairs.length >= count) break;
        }
      }
      date.setDate(date.getDate() + 1);
    }
  }

  return allPairs;
}


function GroupClassDetailPage() {
  const { groupId, date } = useParams(); // e.g. groupId and "02.06"
  const navigate = useNavigate();
  const { db, groups, payments, students } = useData();

  const [group, setGroup] = useState(null);
  const [canceled, setCanceled] = useState({});
  const [signedUp, setSignedUp] = useState([]);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const g = groups.find(g => g.id === groupId);
    setGroup(g);
  }, [groupId, groups]);

  useEffect(() => {
    if (!groupId) return;
    const fetchCanceled = async () => {
      const map = {};
      for (const group of groups) {
        const q = query(collection(db, `groups/${group.id}/canceledClasses`));
        const snap = await getDocs(q);
        map[group.id] = snap.docs.map(d => d.data().date);
      }
      setCanceled(map);
    };
    fetchCanceled();
  }, [db, groups, groupId]);

  useEffect(() => {
    if (!group || Object.keys(canceled).length === 0) return;

    const matched = [];

    for (const payment of payments) {
      if (!payment.groups.includes(groupId)) continue;

      const schedule = generateCombinedSchedule([payment], groups, canceled, payment.type);

      for (const { date: d, groupId: gId } of schedule) {
        if (d === date && gId === groupId) {
          const student = students.find(s => s.id === payment.studentId);
          const perClass = payment.amount / payment.type;
          matched.push({
            id: student?.id,
            name: student?.name,
            amount: perClass.toFixed(2),
          });
        }
      }
    }

    setSignedUp(matched);
    const earned = matched.reduce((sum, s) => sum + parseFloat(s.amount), 0);
    setTotal((earned - 15).toFixed(2));
  }, [group, canceled, payments, students, date, groupId]);

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
          <li
            key={i}
            className="class-item"
            onClick={() => navigate(`/student/${s.id}`)}
          >
            <span>{i + 1} {s.name?.slice(0, 30)}</span>
            <span>{s.amount}€</span>
            <span>➔</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default GroupClassDetailPage;
