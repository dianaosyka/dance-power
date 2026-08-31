import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocsFromServer, runTransaction, Timestamp } from 'firebase/firestore';
import { useNavigate, useParams } from 'react-router-dom';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import { getPaymentMethodLabel } from '../utils/paymentMethodUtils';

import './WorkshopDetailPage.css';

function WorkshopDetailPage() {
  const { workshopId } = useParams();
  const navigate = useNavigate();
  const { db, workshops = [], students = [], coaches = [] } = useData();
  const { user } = useUser();
  const workshop = workshops.find(item => item.id === workshopId);
  const [members, setMembers] = useState([]);
  const [payments, setPayments] = useState([]);
  const [candidate, setCandidate] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const studentById = useMemo(() => new Map(students.map(s => [s.id, s])), [students]);
  const memberIds = useMemo(() => new Set(members.map(m => m.studentId || m.id)), [members]);
  const paidIds = useMemo(() => new Set(payments.filter(p => p.status === 'active').map(p => p.studentId)), [payments]);
  const availableStudents = students.filter(student => !memberIds.has(student.id));
  const matchingStudents = studentSearch.trim()
    ? availableStudents.filter(student => String(student.name || '').toLowerCase().includes(studentSearch.trim().toLowerCase())).slice(0, 8)
    : [];
  const coachNames = new Map(coaches.map(coach => [coach.id, coach.name || coach.id]));

  const load = useCallback(async () => {
    if (!workshopId) return;
    const [memberSnapshot, paymentSnapshot] = await Promise.all([
      getDocsFromServer(collection(db, `workshops/${workshopId}/signedStudents`)),
      getDocsFromServer(collection(db, `workshops/${workshopId}/payments`)),
    ]);
    setMembers(memberSnapshot.docs.map(item => ({ id: item.id, ...item.data() })));
    setPayments(paymentSnapshot.docs.map(item => ({ id: item.id, ...item.data() })));
  }, [db, workshopId]);
  useEffect(() => { load().catch(err => setError(err.message)); }, [load]);

  const signStudent = async () => {
    const student = studentById.get(candidate);
    if (!student || busy) return;
    setBusy(true); setError('');
    try {
      const workshopRef = doc(db, 'workshops', workshopId);
      const memberRef = doc(db, `workshops/${workshopId}/signedStudents`, student.id);
      await runTransaction(db, async transaction => {
        const [workshopSnapshot, memberSnapshot] = await Promise.all([
          transaction.get(workshopRef), transaction.get(memberRef),
        ]);
        if (!workshopSnapshot.exists()) throw new Error('Workshop no longer exists.');
        if (memberSnapshot.exists()) throw new Error('Student is already signed.');
        transaction.set(memberRef, { studentId: student.id, studentName: student.name, signedAt: Timestamp.now(), signedBy: user.id || '' });
        transaction.update(workshopRef, { signedStudentCount: Number(workshopSnapshot.data().signedStudentCount || 0) + 1 });
      });
      setCandidate(''); setStudentSearch(''); await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const removeStudent = async member => {
    const studentId = member.studentId || member.id;
    const studentName = studentById.get(studentId)?.name || member.studentName || studentId;
    if (!studentId || busy || paidIds.has(studentId)) return;
    if (!window.confirm(`Remove ${studentName} from this workshop?`)) return;
    setBusy(true); setError('');
    try {
      const workshopRef = doc(db, 'workshops', workshopId);
      const memberRef = doc(db, `workshops/${workshopId}/signedStudents`, studentId);
      const paymentRef = doc(db, `workshops/${workshopId}/payments`, studentId);
      await runTransaction(db, async transaction => {
        const [workshopSnapshot, memberSnapshot, paymentSnapshot] = await Promise.all([
          transaction.get(workshopRef), transaction.get(memberRef), transaction.get(paymentRef),
        ]);
        if (!workshopSnapshot.exists()) throw new Error('Workshop no longer exists.');
        if (!memberSnapshot.exists()) throw new Error('This student is already removed.');
        if (paymentSnapshot.exists()) throw new Error('A paid participant cannot be removed.');
        transaction.delete(memberRef);
        transaction.update(workshopRef, {
          signedStudentCount: Math.max(0, Number(workshopSnapshot.data()?.signedStudentCount || 0) - 1),
        });
      });
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  if (!workshop) return <main className="workshop-detail-page"><p>Workshop not found.</p></main>;
  return <main className="workshop-detail-page"><div className="workshop-detail-shell">
    <header className="workshop-detail-header"><button onClick={() => navigate('/workshops')}>← Workshops</button><div><p>WORKSHOP</p><h1>{workshop.name}</h1></div></header>
    <section className="workshop-summary">
      <div><span>Date & time</span><strong>{workshop.date} · {workshop.time}</strong></div>
      <div><span>Price</span><strong>€{Number(workshop.price).toFixed(2)}</strong></div>
      <div className="workshop-summary-coaches"><span>Coaches</span><strong>{(workshop.coaches || []).map(id => coachNames.get(id) || id).join(' · ')}</strong></div>
    </section>
    {error && <p className="workshop-detail-error" role="alert">{error}</p>}
    <section className="workshop-panel"><div className="workshop-panel-heading"><div><p>ROSTER</p><h2>Participants <span>{members.length}</span></h2></div><button onClick={() => navigate(`/add-payment?mode=workshop&workshopId=${encodeURIComponent(workshopId)}`)}>+ Add payment</button></div>
      <div className="workshop-signup-search">
        <div className="workshop-student-search">
          <input value={studentSearch} placeholder="Search student to sign…" onChange={event => { setStudentSearch(event.target.value); setCandidate(''); }} />
          {studentSearch && !candidate && <ul>{matchingStudents.map(student => <li key={student.id}><button type="button" onClick={() => { setCandidate(student.id); setStudentSearch(student.name); }}>{student.name}</button></li>)}{matchingStudents.length === 0 && <li className="workshop-search-empty">No students found</li>}</ul>}
        </div>
        <button className="workshop-sign-button" onClick={signStudent} disabled={!candidate || busy}>{busy ? 'Signing…' : 'Sign student'}</button>
      </div>
      <ul className="workshop-participant-list">{members.map(member => {
        const id = member.studentId || member.id; const name = studentById.get(id)?.name || member.studentName || id;
        return <li key={id}><div><strong>{name}</strong><small>{paidIds.has(id) ? 'Payment received' : 'No payment yet'}</small></div><span className={paidIds.has(id) ? 'is-paid' : 'is-unpaid'}>{paidIds.has(id) ? 'Paid' : 'Unpaid'}</span>{!paidIds.has(id) && <><button onClick={() => navigate(`/add-payment?mode=workshop&workshopId=${encodeURIComponent(workshopId)}&studentId=${encodeURIComponent(id)}`)}>Add payment</button><button className="workshop-remove-student" onClick={() => removeStudent(member)} disabled={busy}>Remove</button></>}</li>;
      })}</ul>
    </section>
    <section className="workshop-panel workshop-payment-panel"><div className="workshop-panel-heading"><div><p>TRANSACTIONS</p><h2>Payments <span>{payments.length}</span></h2></div></div><ul className="workshop-payment-list">{payments.map(payment => <li key={payment.id}><button type="button" onClick={() => navigate(`/student/${encodeURIComponent(payment.studentId)}?workshopPaymentId=${encodeURIComponent(payment.id)}&workshopId=${encodeURIComponent(workshopId)}`)} aria-label={`Open workshop payment for ${studentById.get(payment.studentId)?.name || payment.studentName || payment.studentId}`}><div><strong>{studentById.get(payment.studentId)?.name || payment.studentName || payment.studentId}</strong><small>{payment.createdAt} · {getPaymentMethodLabel(payment.paymentMethod)}</small></div><strong>€{Number(payment.amount).toFixed(2)}</strong><span aria-hidden="true">›</span></button></li>)}</ul>{!payments.length && <p className="workshop-panel-empty">No payments recorded yet.</p>}</section>
  </div></main>;
}
export default WorkshopDetailPage;
