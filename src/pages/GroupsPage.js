import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../context/DataContext';
import { useUser } from '../context/UserContext';
import './GroupsPage.css';

function GroupsPage() {
  const { groups } = useData();
  const { user, setUser } = useUser();
  const navigate = useNavigate();

  const handleLogout = () => {
    setUser(null);
    navigate('/login');
  };

  const visibleGroups = user?.role === 'coach'
  ? groups.filter(group => user.groups?.includes(group.id))
  : groups;

  return (
    <div className="page">
      <div className="container">
        <div className="headerBox">
          <h2 className="title">GROUPS</h2>
          <button className="logoutButton" onClick={handleLogout}>
            Logout
          </button>
        </div>

        {user?.role === 'admin' && (<button
          className="students-button"
          onClick={() => navigate('/students')}
        >
          STUDENTS LIST
        </button>)}

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
          <div className="add-button-container">
            <button
              className="add-button"
              onClick={() => navigate('/add-payment')}
            >
              +
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default GroupsPage;
