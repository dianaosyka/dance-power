import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../context/DataContext';
import './GroupsPage.css';

function GroupsPage() {
  const { groups } = useData();
  const navigate = useNavigate();

  return (
    <div className="page">
      <div className="container">
        <h2 className="title">GROUPS</h2>

        <button
          className="students-button"
          onClick={() => navigate('/students')}
        >
          STUDENTS LIST
        </button>

        <ul className="group-list">
          {groups.map(group => (
            <li key={group.id} className="group-item" onClick={() => navigate(`/group/${group.id}`)}>
              <span>{group.name.toUpperCase()}</span>
              <span className="arrow">{'>'}</span>
            </li>
          ))}
        </ul>

        <div className="add-button-container">
          <button className="add-button" onClick={() => navigate('/add-payment')}>+</button>
        </div>
      </div>
    </div>
  );
}

export default GroupsPage;
