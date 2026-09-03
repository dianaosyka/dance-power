import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import CoachTasksPage from './CoachTasksPage';
import GradientActionButton from '../components/GradientActionButton';
import './GroupsPage.css';

function GroupsPage() {
  const { groups } = useData();
  const { user, accountUser, setUser, viewAsCoach, setViewAsCoach } = useUser();
  const navigate = useNavigate();
  const [showHiddenGroups, setShowHiddenGroups] = useState(false);
  const [includeAllWarnings, setIncludeAllWarnings] = useState(false);
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

  const sortGroups = list => [...list].sort((second, first) => first.name.localeCompare(second.name));
  const activeGroups = groups.filter(group => group.hidden !== true);
  const openGroups = sortGroups(activeGroups.filter(group => String(group.type || '').toUpperCase() === 'OPEN'));
  const closedGroups = sortGroups(activeGroups.filter(group => String(group.type || '').toUpperCase() !== 'OPEN'));
  const hiddenGroups = sortGroups(groups.filter(group => group.hidden === true));

  const renderGroupSection = (title, items, variant = '') => (
    <section className={`group-list-section ${variant ? `group-list-section--${variant}` : ''}`}>
      <div className="group-list-heading">
        <h3>{title}</h3>
        <span>{items.length}</span>
      </div>
      <ul className="group-list">
        {items.map(group => (
          <li
            key={group.id}
            className="group-item"
            onClick={() => navigate(`/group/${group.id}`)}
          >
            <span>{variant === 'hidden' && <span className="group-lock" aria-hidden="true">◌</span>}{group.name.toUpperCase()}</span>
            <span className="arrow">{'>'}</span>
          </li>
        ))}
      </ul>
    </section>
  );

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
                <button type="button" onClick={() => goTo('/payment-history')}>History</button>
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

        {(user?.role === 'admin' || user?.role === 'coach') && (
          <CoachTasksPage includeAllWarnings={includeAllWarnings} />
        )}

        {(user?.role === 'admin' || user?.role === 'coach') && (
          <div className="add-button-container">
            <GradientActionButton
              type="button"
              aria-label="Add payment"
              title="Add payment"
              onClick={() => navigate('/add-payment')}
            >
              ADD PAYMENT
            </GradientActionButton>
          </div>
        )}

        {openGroups.length > 0 && renderGroupSection('OPEN CLASSES', openGroups)}
        {closedGroups.length > 0 && renderGroupSection('CLOSED GROUPS', closedGroups, 'closed')}
        {user?.role === 'admin' && showHiddenGroups && hiddenGroups.length > 0 && renderGroupSection('HIDDEN GROUPS', hiddenGroups, 'hidden')}

        {user?.role === 'admin' && hiddenGroups.length > 0 && (
          <div className="hidden-toggle-container">
            <button
              className="hidden-toggle-button"
              onClick={() => setShowHiddenGroups(current => !current)}
            >
              {showHiddenGroups ? 'Hide hidden groups' : `Show hidden groups (${hiddenGroups.length})`}
            </button>
          </div>
        )}

        {accountUser?.role === 'admin' && (
          <div className="view-controls">
            <label className="warnings-scope-toggle warnings-scope-toggle--footer">
              <input
                type="checkbox"
                checked={includeAllWarnings}
                disabled={viewAsCoach}
                onChange={event => setIncludeAllWarnings(event.target.checked)}
              />
              <span>Show all warnings</span>
            </label>
            <label className="view-mode-switch">
              <span>Coach view</span>
              <input
                type="checkbox"
                checked={viewAsCoach}
                onChange={(event) => {
                  setViewAsCoach(event.target.checked);
                  if (event.target.checked) setIncludeAllWarnings(false);
                }}
              />
              <span className="view-mode-slider" aria-hidden="true" />
            </label>
          </div>
        )}

      </div>
    </div>
  );
}

export default GroupsPage;
