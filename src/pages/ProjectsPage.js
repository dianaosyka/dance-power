import React, { useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import { formatProjectDate, getProjectStatus } from '../utils/projectUtils';
import './ProjectsPage.css';

const STATUS_ORDER = ['active', 'upcoming', 'completed'];
const STATUS_LABELS = {
  active: 'Active',
  upcoming: 'Upcoming',
  completed: 'Completed',
};

function formatPrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price)) return '—';
  return new Intl.NumberFormat('sk-SK', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: price % 1 === 0 ? 0 : 2,
  }).format(price);
}

function ProjectsPage() {
  const {
    projects = [],
    projectsLoaded,
    projectsError,
    coaches = [],
  } = useData();
  const { user } = useUser();
  const navigate = useNavigate();
  const [showHidden, setShowHidden] = useState(false);

  const isAdmin = user?.role === 'admin';
  const isStaff = isAdmin || user?.role === 'coach';

  const coachNames = useMemo(
    () => new Map(coaches.map(coach => [
      coach.id,
      coach.name || coach.email || coach.id,
    ])),
    [coaches]
  );

  const projectsByStatus = useMemo(() => {
    const grouped = new Map(STATUS_ORDER.map(status => [status, []]));

    projects
      .filter(project => showHidden || project.hidden !== true)
      .forEach(project => {
        const status = getProjectStatus(project);
        const rows = grouped.get(status) || [];
        rows.push(project);
        grouped.set(status, rows);
      });

    for (const rows of grouped.values()) {
      rows.sort((first, second) => (
        String(first.startDate || '').localeCompare(String(second.startDate || '')) ||
        String(first.name || '').localeCompare(String(second.name || ''))
      ));
    }

    return grouped;
  }, [projects, showHidden]);

  const visibleProjectCount = STATUS_ORDER.reduce(
    (total, status) => total + (projectsByStatus.get(status)?.length || 0),
    0
  );

  if (!isStaff) return <Navigate to="/groups" replace />;

  return (
    <main className="projects-page">
      <div className="projects-shell">
        <header className="projects-header">
          <button
            type="button"
            className="projects-back"
            onClick={() => navigate('/groups')}
          >
            ← Groups
          </button>
          <div>
            <p>FIXED PROGRAMS</p>
            <h1>Projects</h1>
          </div>
          <div className="projects-header-actions">
            <button type="button" className="projects-waiting-link" onClick={() => navigate('/project-waiting-list')}>Waiting list</button>
            {isAdmin && <button type="button" className="projects-create" onClick={() => navigate('/create-group?kind=project')}>+ Create</button>}
          </div>
        </header>

        <div className="projects-toolbar">
          <p>
            <strong>{visibleProjectCount}</strong>
            <span>{visibleProjectCount === 1 ? ' project' : ' projects'}</span>
          </p>
          {isAdmin && (
            <label className="projects-hidden-toggle">
              <input
                type="checkbox"
                checked={showHidden}
                onChange={event => setShowHidden(event.target.checked)}
              />
              <span>Show hidden</span>
            </label>
          )}
        </div>

        {projectsError && (
          <p className="projects-error" role="alert">
            Projects could not be loaded: {projectsError}
          </p>
        )}

        {!projectsLoaded && !projectsError && (
          <div className="projects-message" role="status">Loading projects…</div>
        )}

        {projectsLoaded && visibleProjectCount === 0 && (
          <section className="projects-empty">
            <span aria-hidden="true">✦</span>
            <h2>{showHidden ? 'No projects yet' : 'No visible projects'}</h2>
            <p>
              {isAdmin
                ? 'Create a fixed project with its coach, dates, and payment price.'
                : 'There are no projects to show right now.'}
            </p>
            {isAdmin && (
              <button type="button" onClick={() => navigate('/create-group?kind=project')}>
                Create project
              </button>
            )}
          </section>
        )}

        {projectsLoaded && visibleProjectCount > 0 && (
          <div className="projects-sections">
            {STATUS_ORDER.map(status => {
              const statusProjects = projectsByStatus.get(status) || [];
              if (statusProjects.length === 0) return null;

              return (
                <section className={`projects-section projects-section--${status}`} key={status}>
                  <div className="projects-section-heading">
                    <h2>{STATUS_LABELS[status]}</h2>
                    <span>{statusProjects.length}</span>
                  </div>

                  <ul className="projects-list">
                    {statusProjects.map(project => {
                      const classCount = Number(project.totalClasses);
                      const signedCount = Number(project.signedStudentCount);
                      const coachName = coachNames.get(project.coach) || project.coach || 'No coach';

                      return (
                        <li key={project.id}>
                          <button
                            type="button"
                            className="project-card"
                            onClick={() => navigate(`/project/${project.id}`)}
                            aria-label={`Open project ${project.name || project.id}`}
                          >
                            <div className="project-card-topline">
                              <span className={`project-status project-status--${status}`}>
                                {STATUS_LABELS[status]}
                              </span>
                              {project.hidden === true && (
                                <span className="project-hidden-badge">Hidden</span>
                              )}
                            </div>

                            <div className="project-card-title">
                              <div>
                                <h3>{project.name || 'Untitled project'}</h3>
                                <p>{coachName}</p>
                              </div>
                              <span aria-hidden="true">→</span>
                            </div>

                            <dl className="project-card-details">
                              <div>
                                <dt>Dates</dt>
                                <dd>
                                  {formatProjectDate(project.startDate) || '—'}
                                  <span> – </span>
                                  {formatProjectDate(project.endDate) || '—'}
                                </dd>
                              </div>
                              <div>
                                <dt>Classes</dt>
                                <dd>{Number.isInteger(classCount) && classCount > 0 ? classCount : '—'}</dd>
                              </div>
                              <div>
                                <dt>Price</dt>
                                <dd>{formatPrice(project.price)}</dd>
                              </div>
                              <div>
                                <dt>Signed</dt>
                                <dd>{Number.isFinite(signedCount) && signedCount >= 0 ? signedCount : 0}</dd>
                              </div>
                            </dl>

                            {project.schedule && (
                              <p className="project-card-schedule">{project.schedule}</p>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

export default ProjectsPage;
