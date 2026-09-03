import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, getDocsFromServer, runTransaction, Timestamp } from 'firebase/firestore';
import { Navigate, useNavigate } from 'react-router-dom';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import './ProjectWaitingListPage.css';
import './ProjectWaitingListStyles.css';
import './ProjectWaitingListRedesign.css';

function ProjectWaitingListPage() {
  const navigate = useNavigate();
  const { db, students = [], studentsLoaded, studentsLoading, groups = [] } = useData();
  const { user } = useUser();
  const [waiting, setWaiting] = useState([]);
  const [search, setSearch] = useState('');
  const [styleId, setStyleId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const loadWaitingList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const snapshot = await getDocsFromServer(collection(db, 'projectWaitingList'));
      setWaiting(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))
        .sort((a, b) => String(a.studentName || '').localeCompare(String(b.studentName || ''))));
    } catch (loadError) {
      setError(loadError?.message || 'The waiting list could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { loadWaitingList(); }, [loadWaitingList]);

  const openClassStyles = useMemo(() => groups
    .filter(group => String(group.type || '').toUpperCase() === 'OPEN' && group.hidden !== true)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))), [groups]);
  const selectedStyle = openClassStyles.find(group => group.id === styleId);
  const waitingIds = useMemo(() => new Set(waiting
    .filter(item => item.styleId === styleId)
    .map(item => item.studentId || item.id)), [styleId, waiting]);
  const groupedWaiting = useMemo(() => {
    const groups = new Map();
    waiting.forEach(member => {
      const label = String(member.styleName || member.style || 'Previous waiting list').trim();
      const key = member.styleId || label.toLocaleLowerCase();
      if (!groups.has(key)) groups.set(key, { label, members: [] });
      groups.get(key).members.push(member);
    });
    return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [waiting]);
  const matches = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    if (!term) return [];
    return students
      .filter(student => !waitingIds.has(student.id))
      .filter(student => [student.name, student.phone, student.email, student.instagram]
        .some(value => String(value || '').toLocaleLowerCase().includes(term)))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      .slice(0, 15);
  }, [search, students, waitingIds]);

  const addStudent = async student => {
    if (!student?.id || !selectedStyle || busyId) return;
    const entryId = `${encodeURIComponent(selectedStyle.id)}--${student.id}`;
    setBusyId(entryId); setError('');
    const waitingRef = doc(db, 'projectWaitingList', entryId);
    const data = {
      studentId: student.id,
      studentName: student.name || student.id,
      phone: student.phone || '',
      email: student.email || '',
      instagram: student.instagram || '',
      styleId: selectedStyle.id,
      styleName: selectedStyle.name || selectedStyle.id,
      addedAt: Timestamp.now(),
      addedBy: user?.id || '',
    };
    try {
      await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(waitingRef);
        if (snapshot.exists()) throw new Error('This student is already on the waiting list.');
        transaction.set(waitingRef, data);
      });
      setWaiting(current => [...current, { id: entryId, ...data }]
        .sort((a, b) => String(a.studentName || '').localeCompare(String(b.studentName || ''))));
      setSearch('');
    } catch (actionError) {
      setError(actionError?.message || 'The student could not be added.');
    } finally {
      setBusyId('');
    }
  };

  const removeStudent = async member => {
    const studentId = member.studentId || member.id;
    const entryId = member.id;
    if (busyId || !window.confirm(`Remove ${member.studentName || studentId} from the ${member.styleName || member.style || 'selected'} waiting list?`)) return;
    setBusyId(entryId); setError('');
    const waitingRef = doc(db, 'projectWaitingList', entryId);
    try {
      await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(waitingRef);
        if (!snapshot.exists()) throw new Error('This student is no longer on the waiting list.');
        transaction.delete(waitingRef);
      });
      setWaiting(current => current.filter(item => item.id !== entryId));
    } catch (actionError) {
      setError(actionError?.message || 'The student could not be removed.');
    } finally {
      setBusyId('');
    }
  };

  if (user?.role !== 'admin' && user?.role !== 'coach') return <Navigate to="/" replace />;

  return <main className="project-waiting-page"><div className="project-waiting-shell">
    <header className="project-waiting-header">
      <button type="button" onClick={() => navigate('/projects')}>← Projects</button>
      <div><p>PROJECT WAITLIST</p><h1>Waiting list</h1></div>
      <strong>{waiting.length}</strong>
    </header>

    <section className="project-waiting-add">
      <p>ADD FROM OPEN CLASSES</p>
      <h2>Add a student</h2>
      <label className="project-waiting-style-label" htmlFor="project-waiting-style">Open class style</label>
      <select id="project-waiting-style" className="project-waiting-style" value={styleId} onChange={event => { setStyleId(event.target.value); setSearch(''); }}>
        <option value="">Choose from open classes</option>
        {openClassStyles.map(group => <option key={group.id} value={group.id}>{group.name || group.id}</option>)}
      </select>
      {openClassStyles.length === 0 && <p className="project-waiting-style-help">No visible open classes are available.</p>}
      <div className="project-waiting-search">
        <input aria-label="Search student for waiting list" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={styleId ? 'Name, phone, email, or Instagram' : 'Choose an open class first'} disabled={!styleId || !studentsLoaded || studentsLoading || Boolean(busyId)} />
        {search.trim() && <ul>{matches.length ? matches.map(student => <li key={student.id}>
          <span><strong>{student.name || student.id}</strong><small>{student.phone || student.instagram || student.email || ''}</small></span>
          <button type="button" onClick={() => addStudent(student)} disabled={Boolean(busyId)}>{busyId.endsWith(`--${student.id}`) ? 'Adding…' : '+ Add'}</button>
        </li>) : <li className="is-empty">No available students found.</li>}</ul>}
      </div>
    </section>

    {error && <p className="project-waiting-error" role="alert">{error}</p>}
    <section className="project-waiting-list-card">
      <div className="project-waiting-title"><div><p>INTERESTED STUDENTS</p><h2>Waiting for a project</h2></div><span>{waiting.length}</span></div>
      {loading ? <p className="project-waiting-empty">Loading waiting lists…</p> : waiting.length === 0 ? <p className="project-waiting-empty">No students on any waiting list yet.</p> : <div className="project-waiting-groups">
        {groupedWaiting.map(group => <section key={group.label} className="project-waiting-group"><header><h3>{group.label}</h3><span>{group.members.length}</span></header><ul className="project-waiting-list">
        {group.members.map(member => <li key={member.id}>
          <button type="button" className="project-waiting-person" onClick={() => navigate(`/student/${encodeURIComponent(member.studentId || member.id)}`)}>
            <span className="project-waiting-avatar">{String(member.studentName || '?').trim().charAt(0).toUpperCase()}</span>
            <span><strong>{member.studentName || member.id}</strong><small>{[member.phone, member.instagram, member.email].filter(Boolean).join(' · ') || 'No contact details'}</small></span>
          </button>
          <button type="button" className="project-waiting-remove" onClick={() => removeStudent(member)} disabled={Boolean(busyId)}>{busyId === member.id ? '…' : 'Remove'}</button>
        </li>)}
      </ul></section>)}
      </div>}
    </section>
  </div></main>;
}

export default ProjectWaitingListPage;
