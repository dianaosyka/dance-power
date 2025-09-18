import React, { useState } from 'react';
import { useData } from '../context/firebase';
import './StudentsListPage.css';
import AddStudentModal from '../components/AddStudentModal';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../context/UserContext';

function StudentsListPage() {
  const { students, groups } = useData();
  const { user } = useUser();
  const [selectedGroup, setSelectedGroup] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showModal, setShowModal] = useState(false);
  const navigate = useNavigate();

  const filteredStudents = students.filter(student => {
    const matchesGroup = selectedGroup ? student.groups.includes(selectedGroup) : true;
    const matchesSearch = student.name.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesGroup && matchesSearch;
  });

  return (
    <div className="students-page">
      <div className="students-container">
        <h2 className="students-title">STUDENTS LIST</h2>

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
          {user?.role === "admin" &&<button className="add-student-button" onClick={() => setShowModal(true)}>
            +
          </button>}
        </div>

        <br />

        <div className="students-header">
          <span>PERSON</span>
          <span>CHOOSE</span>
        </div>

        <ul className="students-list">
          {filteredStudents.map(student => (
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
