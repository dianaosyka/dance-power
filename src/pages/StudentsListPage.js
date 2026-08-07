import React, { useState } from 'react';
import { useData } from '../context/firebase';
import './StudentsListPage.css';
import AddStudentModal from '../components/AddStudentModal';
import RefreshStatus from '../components/RefreshStatus';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../context/UserContext';

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
    const matchesGroup = selectedGroup ? (student.groups || []).includes(selectedGroup) : true;
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

        <select
          className="group-select"
          value={selectedGroup}
          onChange={e => setSelectedGroup(e.target.value)}
        >
          <option value="">GROUP</option>
          {groups.map(group => (
            <option key={group.id} value={group.id}>
              {group.name.toUpperCase()}
            </option>
          ))}
        </select>

        <input
          type="text"
          placeholder="Search student..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="input"
          style={{ width: '95%' }}
        />

        <div className="people-header">
          <h3 className="people-title">PEOPLE</h3>
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
              +
            </button>
          )}
        </div>

        <br />

        <div className="students-header">
          <span>PERSON</span>
          <span>CHOOSE</span>
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
              <span>{student.name.toUpperCase().slice(0, 30)}</span>
              <span className="arrow">{'>'}</span>
            </li>
          ))}
        </ul>
      </div>

      {showModal && (
        <AddStudentModal
          groupId={selectedGroup}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

export default StudentsListPage;
