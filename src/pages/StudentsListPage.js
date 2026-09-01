import React, { useState } from 'react';
import { useData } from '../context/firebase';
import './StudentsListPage.css';
import AddStudentModal from '../components/AddStudentModal';
import RefreshStatus from '../components/RefreshStatus';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../context/UserContext';

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2)
    .map(part => part[0]).join('').toUpperCase();
}

function StudentsListPage() {
  const {
    students,
    groups,
    studentsLoaded,
    studentsLoading,
    studentsError,
    studentsLastLoadedAt,
    refreshStudents,
  } = useData();
  const { user } = useUser();
  const [selectedGroup, setSelectedGroup] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const navigate = useNavigate();

  const filteredStudents = students.filter(student => {
    const selectedGroupRecord = groups.find(group => group.id === selectedGroup);
    const matchesGroup = selectedGroup
      ? (selectedGroupRecord?.signedStudents || []).includes(student.id)
      : true;
    const matchesSearch = String(student.name || '')
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    return matchesGroup && matchesSearch;
  });

  const lastLoadedText = studentsLastLoadedAt
    ? new Date(studentsLastLoadedAt).toLocaleString()
    : 'not updated yet';

  const handleRefreshStudents = async () => {
    try {
      await refreshStudents();
    } catch (err) {
      // The shared data context exposes the error in the status message below.
      console.error('Failed to refresh students:', err);
    }
  };

  return (
    <div className="students-page">
      <div className="students-container">
        <h2 className="students-title">STUDENTS LIST</h2>

        <RefreshStatus
          message={studentsLoaded ? `Last updated: ${lastLoadedText}` : 'Not updated yet'}
          error={studentsError ? `Could not load students: ${studentsError}` : ''}
          loading={studentsLoading}
          onRefresh={handleRefreshStudents}
          refreshLabel="Refresh students"
        />

        <div className="students-filters">
          <label className="students-filter-field">
            <span>GROUP</span>
            <select
              className="group-select"
              value={selectedGroup}
              onChange={e => setSelectedGroup(e.target.value)}
            >
              <option value="">All groups</option>
              {groups.map(group => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>

          <label className="students-filter-field students-search-field">
            <span>SEARCH</span>
            <div>
              <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>
              <input
                type="text"
                placeholder="Search by name…"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="input"
              />
              {searchTerm && <button className="search-clear-button" type="button" onClick={() => setSearchTerm('')} aria-label="Clear search" />}
            </div>
          </label>
        </div>

        <div className="people-header">
          <div>
            <p>DIRECTORY</p>
            <h3 className="people-title">PEOPLE <span>{filteredStudents.length}</span></h3>
          </div>
          {user?.role === 'admin' && (
            <button
              className="add-student-button"
              onClick={() => setShowModal(true)}
              disabled={!studentsLoaded || studentsLoading}
              title={
                !studentsLoaded || studentsLoading
                  ? 'Wait for students to finish loading'
                  : 'Add student'
              }
            >
              <span aria-hidden="true">+</span> Add student
            </button>
          )}
        </div>

        <ul className="students-list">
          {!studentsLoaded && studentsLoading && (
            <li className="student-item">Loading students...</li>
          )}
          {studentsLoaded && filteredStudents.length === 0 && (
            <li className="student-item">
              {students.length === 0 ? 'No students found.' : 'No students match these filters.'}
            </li>
          )}
          {studentsLoaded && filteredStudents.map(student => (
            <li
              key={student.id}
              className="student-item"
              onClick={() => navigate(`/student/${student.id}`)}
            >
              <span className="students-list-avatar" aria-hidden="true">{initials(student.name)}</span>
              <span className="students-list-name">{student.name.toUpperCase().slice(0, 40)}</span>
              <span className="arrow">›</span>
            </li>
          ))}
        </ul>
      </div>

      {showModal && (
        <AddStudentModal
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

export default StudentsListPage;
