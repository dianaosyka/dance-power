import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import './WorkshopsPage.css';

function formatWorkshopDate(value) {
  const [year, month, day] = String(value || '').split('-');
  return year && month && day ? `${day}.${month}.${year}` : value || 'Date not set';
}

function WorkshopsPage() {
  const { workshops = [], coaches = [] } = useData();
  const { user } = useUser();
  const navigate = useNavigate();
  const [showHidden, setShowHidden] = useState(false);
  const coachNames = new Map(coaches.map(coach => [coach.id, coach.name || coach.id]));
  const visible = workshops.filter(item => showHidden || item.hidden !== true)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return <main className="workshops-page"><div className="workshops-shell">
    <header className="workshops-header"><button className="workshops-back" onClick={() => navigate('/groups')}>← Groups</button><div><p>EVENTS</p><h1>Workshops</h1></div>{user?.role === 'admin' ? <button className="workshops-create" onClick={() => navigate('/create-workshop')}>+ Create</button> : <span />}</header>
    <div className="workshops-toolbar"><span>{visible.length} {visible.length === 1 ? 'workshop' : 'workshops'}</span>{user?.role === 'admin' && <label><input type="checkbox" checked={showHidden} onChange={event => setShowHidden(event.target.checked)} /> Show hidden</label>}</div>
    <ul className="workshops-list">{visible.map(workshop => <li key={workshop.id}>
      <button className="workshop-card" onClick={() => navigate(`/workshop/${workshop.id}`)}>
        <div className="workshop-card-date"><strong>{formatWorkshopDate(workshop.date)}</strong><span>{workshop.time || '—'}</span></div>
        <div className="workshop-card-body"><strong>{workshop.name}</strong><span>{(workshop.coaches || []).map(id => coachNames.get(id) || id).join(' · ') || 'No coach'}</span></div>
        <div className="workshop-card-price">€{Number(workshop.price || 0).toFixed(2)}<span>›</span></div>
      </button>
    </li>)}</ul>
    {!visible.length && <div className="workshops-empty"><strong>No workshops found</strong><span>Create the first workshop to get started.</span></div>}
  </div></main>;
}
export default WorkshopsPage;
