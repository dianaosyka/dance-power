import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import './GroupsPage.css';

function GroupsPage() {
  const { groups } = useData();
  const { user, setUser } = useUser();
  const navigate = useNavigate();
  const [showHiddenGroups, setShowHiddenGroups] = useState(false);

  const handleLogout = () => {
    setUser(null);
    navigate('/login');
  };

  const visibleGroups = groups
    .filter(group => showHiddenGroups || group.hidden !== true)
    .sort((b, a) => a.name.localeCompare(b.name));

  return (
    <div className="page">
      <div className="container">
        <div className="headerBox">
          <h2 className="title">GROUPS</h2>
          <button className="logoutButton" onClick={handleLogout}>
            Logout
          </button>
        </div>

        <button
          className="students-button"
          onClick={() => navigate('/students')}
        >
          STUDENTS LIST
        </button>
        <button
          className="students-button"
          onClick={() => navigate('/payment-history')}
        >
          PAYMENT HISTORY
        </button>
        {(user?.role === 'admin' || user?.role === 'coach') && (
          <button
            className="students-button"
            onClick={() => navigate('/salary')}
          >
            SALARY
          </button>
        )}

        {user?.role === 'admin' && (
          <div className="add-button-container">
            <button
              className="add-button"
              onClick={() => navigate('/add-payment')}
            >
              +
            </button>
          </div>
        )}

        <ul className="group-list">
          {visibleGroups.map(group => (
            <li
              key={group.id}
              className="group-item"
              onClick={() => navigate(`/group/${group.id}`)}
            >
              <span>{group.name.toUpperCase()}</span>
              <span className="arrow">{'>'}</span>
            </li>
          ))}
        </ul>

        {user?.role === 'admin' && (
          <div className="hidden-toggle-container">
            <button
              className="hidden-toggle-button"
              onClick={() => setShowHiddenGroups(current => !current)}
            >
              {showHiddenGroups ? 'Hide hidden groups' : 'Show hidden groups'}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}

export default GroupsPage;
