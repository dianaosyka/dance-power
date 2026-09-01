import React, { useEffect, useMemo, useState } from 'react';
import { doc, runTransaction, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import { invalidateSalarySummaries } from '../utils/salaryCache';
import './GroupDetailsPage.css';

const WEEKDAYS = [
  'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY',
];

function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toUpperCase();
}

function GroupDetailsPage() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const { db, groups, groupsLoaded, students, studentsLoaded, studentsLoading, coaches } = useData();
  const { user } = useUser();
  const group = groups.find(item => item.id === groupId);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [coach, setCoach] = useState('');
  const [dayOfWeek, setDayOfWeek] = useState('1');
  const [time, setTime] = useState('');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [changingStudentId, setChangingStudentId] = useState('');
  const canManageStudents = user?.role === 'admin' || user?.role === 'coach';

  useEffect(() => {
    if (!group) return;
    setName(group.name || '');
    setCoach(group.coach || '');
    setDayOfWeek(String(group.dayOfWeek ?? 1));
    setTime(group.time || '');
  }, [group]);

  const signedIds = useMemo(
    () => new Set(Array.isArray(group?.signedStudents) ? group.signedStudents : []),
    [group?.signedStudents]
  );
  const signedStudents = useMemo(
    () => students
      .filter(student => signedIds.has(student.id))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [signedIds, students]
  );
  const availableStudents = useMemo(() => {
    const term = search.trim().toLowerCase();
    return students
      .filter(student => !signedIds.has(student.id))
      .filter(student => !term || String(student.name || '').toLowerCase().includes(term))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }, [search, signedIds, students]);

  const saveDetails = async event => {
    event.preventDefault();
    if (user?.role !== 'admin' || saving || !name.trim() || !coach || !time) return;
    setSaving(true);
    try {
      const weekday = Number(dayOfWeek);
      await updateDoc(doc(db, 'groups', groupId), {
        name: name.trim(),
        coach,
        dayOfWeek: weekday,
        time,
        schedule: `${WEEKDAYS[weekday]} ${time}`,
        updatedAt: serverTimestamp(),
        updatedBy: user.id || user.email || '',
      });
      invalidateSalarySummaries();
      setEditing(false);
    } catch (error) {
      console.error('Failed to update group:', error);
      alert('❌ Group details could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const changeEnrollment = async (studentId, shouldSign) => {
    if (!canManageStudents || changingStudentId) return;
    setChangingStudentId(studentId);
    try {
      await runTransaction(db, async transaction => {
        const groupRef = doc(db, 'groups', groupId);
        const snapshot = await transaction.get(groupRef);
        if (!snapshot.exists()) throw new Error('Group does not exist.');
        const current = Array.isArray(snapshot.data().signedStudents)
          ? snapshot.data().signedStudents
          : [];
        const next = shouldSign
          ? Array.from(new Set([...current, studentId]))
          : current.filter(id => id !== studentId);
        transaction.update(groupRef, {
          signedStudents: next,
          signedStudentsUpdatedAt: serverTimestamp(),
          signedStudentsUpdatedBy: user.id || user.email || '',
        });
      });
    } catch (error) {
      console.error('Failed to update signed students:', error);
      alert('❌ The signed students list could not be updated.');
    } finally {
      setChangingStudentId('');
    }
  };

  if (user?.role !== 'admin' && user?.role !== 'coach') return <Navigate to="/" replace />;
  if (groupsLoaded && !group) return <Navigate to="/groups" replace />;

  return (
    <main className="group-details-page">
      <header className="group-details-header">
        <button className="group-details-back" type="button" onClick={() => navigate(`/group/${groupId}`)} aria-label="Back to group">←</button>
        <div><p>GROUP DETAILS</p><h1>{group?.name || 'Loading…'}</h1></div>
      </header>

      <section className="group-details-card">
        <div className="group-details-section-title">
          <div><p className="section-kicker">OVERVIEW</p><h2>Group information</h2></div>
          {user?.role === 'admin' && !editing && (
            <button className="edit-details-button" type="button" onClick={() => setEditing(true)}>Edit</button>
          )}
        </div>
        {editing ? (
          <form className="group-edit-form" onSubmit={saveDetails}>
            <label>Name<input value={name} onChange={event => setName(event.target.value)} required /></label>
            <label>Coach<select value={coach} onChange={event => setCoach(event.target.value)} required>
              <option value="">Select coach</option>
              {coaches.map(item => <option key={item.id} value={item.id}>{item.name || item.email}</option>)}
            </select></label>
            <label>Day<select value={dayOfWeek} onChange={event => setDayOfWeek(event.target.value)}>
              {WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}
            </select></label>
            <label>Time<input type="time" value={time} onChange={event => setTime(event.target.value)} required /></label>
            <div className="group-edit-actions">
              <button type="button" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
              <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        ) : (
          <dl className="group-details-summary">
            <div><dt><span aria-hidden="true">◷</span>Schedule</dt><dd>{group?.schedule || '—'}</dd></div>
            <div><dt><span aria-hidden="true" className="coach-person-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.25" /><path d="M5.5 19c.7-3.2 3-5 6.5-5s5.8 1.8 6.5 5" /></svg></span>Coach</dt><dd>{coaches.find(item => item.id === group?.coach)?.name || '—'}</dd></div>
          </dl>
        )}
      </section>

      <section className="group-details-card">
        <div className="group-details-section-title">
          <div><p className="section-kicker">ENROLLED</p><h2>Signed students <span className="student-count">{signedStudents.length}</span></h2></div>
        </div>
        {!studentsLoaded && studentsLoading && <p>Loading students…</p>}
        {studentsLoaded && signedStudents.length === 0 && <p className="group-empty">No students signed yet.</p>}
        <ul className="signed-student-list">
          {signedStudents.map(student => (
            <li key={student.id}>
              <button className="student-link" type="button" onClick={() => navigate(`/student/${student.id}`)}>
                <span className="student-avatar" aria-hidden="true">{initials(student.name || student.email)}</span>
                <span className="student-name">{student.name || student.email || student.id}</span>
                <span className="student-chevron">›</span>
              </button>
              <button className="student-remove" type="button" onClick={() => changeEnrollment(student.id, false)} disabled={Boolean(changingStudentId)}>
                {changingStudentId === student.id ? '…' : 'Remove'}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="group-details-card">
        <p className="section-kicker">ADD PEOPLE</p>
        <h2>Sign a student</h2>
        <p className="section-description">Search the student list and add someone to this group.</p>
        <div className="student-search-wrap">
          <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>
          <input className="student-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by name…" />
          {search && <button className="search-clear-button" type="button" onClick={() => setSearch('')} aria-label="Clear search" />}
        </div>
        <ul className="available-student-list">
          {studentsLoaded && availableStudents.length === 0 && <li className="group-empty">No students found.</li>}
          {availableStudents.map(student => (
            <li key={student.id}>
              <button type="button" onClick={() => navigate(`/student/${student.id}`)}>
                <span className="student-avatar" aria-hidden="true">{initials(student.name || student.email)}</span>
                <span className="student-name">{student.name || student.email || student.id}</span>
              </button>
              <button type="button" onClick={() => changeEnrollment(student.id, true)} disabled={Boolean(changingStudentId)}>
                {changingStudentId === student.id ? '…' : '+ Sign'}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

export default GroupDetailsPage;
