import React, { useMemo, useRef, useState } from 'react';
import { addDoc, collection, Timestamp } from 'firebase/firestore';
import { Navigate, useNavigate } from 'react-router-dom';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import { invalidateSalarySummaries } from '../utils/salaryCache';
import './CreateWorkshopPage.css';

function CreateWorkshopPage() {
  const { db, coaches = [], coachesLoaded } = useData();
  const { user } = useUser();
  const navigate = useNavigate();
  const submittingRef = useRef(false);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [price, setPrice] = useState('');
  const [coachIds, setCoachIds] = useState([]);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [coachPickerOpen, setCoachPickerOpen] = useState(false);
  const sortedCoaches = useMemo(() => [...coaches].sort((a, b) =>
    String(a.name || a.id).localeCompare(String(b.name || b.id))), [coaches]);

  const toggleCoach = id => setCoachIds(current => current.includes(id)
    ? current.filter(item => item !== id) : [...current, id]);

  const submit = async event => {
    event.preventDefault();
    const amount = Number(String(price).replace(',', '.'));
    if (!name.trim() || !date || !time || !Number.isFinite(amount) || amount <= 0 || !coachIds.length) {
      setError('Enter a name, date, time, price, and select at least one coach.');
      return;
    }
    if (!coachesLoaded || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError('');
    try {
      const ref = await addDoc(collection(db, 'workshops'), {
        name: name.trim(), date, time, price: amount, coaches: coachIds,
        hidden, signedStudentCount: 0, type: 'WORKSHOP',
        createdAt: Timestamp.now(), createdBy: user.id || user.email || '',
      });
      invalidateSalarySummaries();
      navigate(`/workshop/${ref.id}`);
    } catch (err) {
      console.error(err);
      setError('The workshop could not be created. Nothing was saved.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (user?.role !== 'admin') return <Navigate to="/workshops" replace />;
  return (
    <main className="create-workshop-page"><div className="create-workshop-shell">
      <header className="create-workshop-header">
        <button type="button" className="create-workshop-back" onClick={() => navigate('/workshops')}>← Workshops</button>
        <div><p>NEW EVENT</p><h1>Create workshop</h1></div>
      </header>
      <form className="create-workshop-form" onSubmit={submit}>
        <label className="workshop-field"><span>Name</span><input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. K-pop intensive" /></label>
        <div className="workshop-field-grid">
          <label className="workshop-field"><span>Date</span><input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          <label className="workshop-field"><span>Time</span><input type="time" value={time} onChange={e => setTime(e.target.value)} /></label>
          <label className="workshop-field"><span>Price</span><div className="workshop-price-input"><b>€</b><input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" /></div></label>
        </div>
        <div className="workshop-coach-picker">
          <span className="workshop-control-label">Coaches</span>
          <button type="button" className="workshop-coach-trigger" aria-expanded={coachPickerOpen} onClick={() => setCoachPickerOpen(value => !value)}>
            <span>{coachIds.length ? `${coachIds.length} selected` : 'Select coaches'}</span><b aria-hidden="true">⌄</b>
          </button>
          {coachPickerOpen && <div className="workshop-coach-options">
            {sortedCoaches.map(coach => <label key={coach.id} className={coachIds.includes(coach.id) ? 'is-selected' : ''}>
              <input type="checkbox" checked={coachIds.includes(coach.id)} onChange={() => toggleCoach(coach.id)} />
              <span>{coach.name || coach.email || coach.id}</span>
            </label>)}
          </div>}
          {coachIds.length > 0 && <div className="workshop-coach-chips">{coachIds.map(id => {
            const coach = coaches.find(item => item.id === id);
            return <button type="button" key={id} onClick={() => toggleCoach(id)}>{coach?.name || coach?.email || id}<span>×</span></button>;
          })}</div>}
        </div>
        <label className="workshop-hidden"><input type="checkbox" checked={hidden} onChange={e => setHidden(e.target.checked)} /><span>Hide workshop from regular lists</span></label>
        {error && <p className="workshop-form-error" role="alert">{error}</p>}
        <div className="create-workshop-actions"><button type="button" onClick={() => navigate('/workshops')}>Cancel</button><button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create workshop'}</button></div>
      </form>
    </div></main>
  );
}

export default CreateWorkshopPage;
