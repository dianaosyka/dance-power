import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import CoachTasksPage from './CoachTasksPage';
import './GroupsPage.css';

function GroupsPage() {
  const { groups } = useData();
  const { user, accountUser, setUser, viewAsCoach, setViewAsCoach } = useUser();
  const navigate = useNavigate();
  const [showHiddenGroups, setShowHiddenGroups] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeOnOutsideClick = event => {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const closeOnEscape = event => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  const goTo = path => {
    setMenuOpen(false);
    navigate(path);
  };

  const handleLogout = () => {
    setMenuOpen(false);
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
          <div className="main-menu" ref={menuRef}>
            <button
              type="button"
              className="burger-button"
              aria-label={menuOpen ? 'Close main menu' : 'Open main menu'}
              aria-expanded={menuOpen}
              aria-controls="main-navigation-menu"
              onClick={() => setMenuOpen(current => !current)}
            >
              <span /><span /><span />
            </button>
            {menuOpen && (
              <nav id="main-navigation-menu" className="burger-menu" aria-label="Main navigation">
                {(user?.role === 'admin' || user?.role === 'coach') && (
                  <>
                    <button type="button" onClick={() => goTo('/projects')}>Projects</button>
                    <button type="button" onClick={() => goTo('/workshops')}>Workshops</button>
                  </>
                )}
                <button type="button" onClick={() => goTo('/students')}>Students list</button>
                <button type="button" onClick={() => goTo('/schedule')}>Schedule</button>
                <button type="button" onClick={() => goTo('/payment-history')}>Payment history</button>
                {(user?.role === 'admin' || user?.role === 'coach') && (
                  <button type="button" onClick={() => goTo('/salary')}>Salary</button>
                )}
                {user?.role === 'admin' && (
                  <button
                    type="button"
                    className="burger-menu-create"
                    onClick={() => goTo('/create-group')}
                  >
                    Creation for groups and projects
                  </button>
                )}
                <button type="button" className="burger-menu-logout" onClick={handleLogout}>Logout</button>
              </nav>
            )}
          </div>
        </div>

        {(user?.role === 'admin' || user?.role === 'coach') && <CoachTasksPage />}

        {(user?.role === 'admin' || user?.role === 'coach') && (
          <div className="add-button-container">
            <button
              type="button"
              className="add-button"
              aria-label="Add payment"
              title="Add payment"
              onClick={() => navigate('/add-payment')}
            >
              <span className="add-button-icon" aria-hidden="true">+</span>
              <span>ADD PAYMENT</span>
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

        {accountUser?.role === 'admin' && (
          <label className="view-mode-switch">
            <span>Coach view</span>
            <input
              type="checkbox"
              checked={viewAsCoach}
              onChange={(event) => setViewAsCoach(event.target.checked)}
            />
            <span className="view-mode-slider" aria-hidden="true" />
          </label>
        )}

      </div>
    </div>
  );
}

export default GroupsPage;
