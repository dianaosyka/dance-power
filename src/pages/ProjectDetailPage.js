import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  collection,
  doc,
  getDocsFromServer,
  runTransaction,
  Timestamp,
} from 'firebase/firestore';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import RefreshStatus from '../components/RefreshStatus';
import { invalidateSalarySummaries } from '../utils/salaryCache';
import { invalidateProjectPaymentHistory } from '../utils/projectPaymentsCache';
import {
  getPaymentMethodLabel,
} from '../utils/paymentMethodUtils';
import {
  getAvailableProjectPaymentParts,
  getProjectPaymentProgress,
  getProjectPaymentsForStudent,
  PROJECT_PAYMENT_PART_LABELS,
} from '../utils/projectPaymentUtils';
import {
  formatLocalIsoDate,
  formatProjectDate,
  generateProjectSchedule,
  getProjectStatus,
} from '../utils/projectUtils';
import './ProjectDetailPage.css';

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

const PROJECT_STATUS_LABELS = {
  upcoming: 'Upcoming',
  active: 'Active',
  completed: 'Completed',
};

function getErrorMessage(error) {
  return error?.message || String(error || 'Unknown error');
}

function createProjectActionError(code, message) {
  const error = new Error(message);
  error.projectActionCode = code;
  return error;
}

function getSignedStudentCount(value) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? count : 0;
}

function parseAmount(value) {
  return Number(String(value ?? '').replace(',', '.'));
}

function formatMoney(value) {
  const amount = parseAmount(value);
  return Number.isFinite(amount) ? `${amount.toFixed(2)}€` : '—';
}

function formatTimestampValue(timestamp) {
  if (typeof timestamp?.toMillis === 'function') return timestamp.toMillis();
  if (Number.isFinite(Number(timestamp?.seconds))) {
    return Number(timestamp.seconds) * 1000;
  }
  return 0;
}

function sortSignedStudents(items) {
  return [...items].sort((first, second) => (
    String(first.studentName || first.name || first.id || '')
      .localeCompare(String(second.studentName || second.name || second.id || ''))
  ));
}

function sortProjectPayments(items) {
  return [...items].sort((first, second) => {
    const timeDifference = formatTimestampValue(second.timestamp)
      - formatTimestampValue(first.timestamp);
    return timeDifference || String(second.id || '').localeCompare(String(first.id || ''));
  });
}

function getMutationLabel(mutationKey, expectedKey, pendingLabel, idleLabel) {
  return mutationKey === expectedKey ? pendingLabel : idleLabel;
}

function ProjectDetailPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const {
    db,
    projects,
    projectsLoaded,
    projectsError,
    coaches,
    students,
    studentsLoaded,
    studentsLoading,
    studentsError,
    studentsLastLoadedAt,
    refreshStudents,
  } = useData();
  const { user } = useUser();

  const isAdmin = user?.role === 'admin';
  const isCoach = user?.role === 'coach';
  const isStaff = isAdmin || isCoach;
  const project = useMemo(
    () => (projects || []).find(item => item.id === projectId) || null,
    [projectId, projects]
  );

  const [signedStudents, setSignedStudents] = useState([]);
  const [projectPayments, setProjectPayments] = useState([]);
  const [signedStudentsLoaded, setSignedStudentsLoaded] = useState(false);
  const [projectPaymentsLoaded, setProjectPaymentsLoaded] = useState(false);
  const [projectDataLoading, setProjectDataLoading] = useState(false);
  const [signedStudentsError, setSignedStudentsError] = useState('');
  const [projectPaymentsError, setProjectPaymentsError] = useState('');
  const [projectDataLoadedAt, setProjectDataLoadedAt] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [studentSearch, setStudentSearch] = useState('');
  const [activeMutation, setActiveMutation] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionMessage, setActionMessage] = useState('');

  const projectLoadGeneration = useRef(0);
  const refreshInProgress = useRef(false);
  const mutationInProgress = useRef(false);
  const activeProjectId = useRef(projectId);
  activeProjectId.current = projectId;

  const generatedSchedule = useMemo(
    () => project ? generateProjectSchedule(project) : [],
    [project]
  );
  const todayIso = formatLocalIsoDate(new Date());
  const elapsedClasses = generatedSchedule.filter(item => item.isoDate < todayIso).length;
  const todayClasses = generatedSchedule.filter(item => item.isoDate === todayIso).length;
  const configuredClassCount = Number(project?.totalClasses);
  const totalClasses = Number.isInteger(configuredClassCount) && configuredClassCount > 0
    ? configuredClassCount
    : generatedSchedule.length;
  const progressPercent = totalClasses > 0
    ? Math.min(100, Math.round((elapsedClasses / totalClasses) * 100))
    : 0;
  const projectStatus = project ? getProjectStatus(project) : 'upcoming';

  const coachName = useMemo(() => {
    const coach = (coaches || []).find(item => item.id === project?.coach);
    return coach?.name || coach?.email || project?.coach || 'Not assigned';
  }, [coaches, project?.coach]);

  const signedStudentIds = useMemo(
    () => new Set(signedStudents.map(item => item.studentId || item.id)),
    [signedStudents]
  );
  const studentsById = useMemo(
    () => new Map((students || []).map(student => [student.id, student])),
    [students]
  );

  const displayedSignedStudents = useMemo(
    () => sortSignedStudents(signedStudents.map(member => {
      const studentId = member.studentId || member.id;
      const currentStudent = studentsById.get(studentId);
      return {
        ...member,
        id: studentId,
        studentId,
        studentName: currentStudent?.name || member.studentName || studentId,
      };
    })),
    [signedStudents, studentsById]
  );

  const sortedPayments = useMemo(
    () => sortProjectPayments(projectPayments),
    [projectPayments]
  );

  const availableStudentMatches = useMemo(() => {
    const normalizedSearch = studentSearch.trim().toLocaleLowerCase();
    if (!normalizedSearch || !studentsLoaded) return [];

    return (students || [])
      .filter(student => !signedStudentIds.has(student.id))
      .filter(student => [student.name, student.phone, student.id]
        .some(value => String(value || '').toLocaleLowerCase().includes(normalizedSearch)))
      .sort((first, second) => String(first.name || '').localeCompare(String(second.name || '')))
      .slice(0, 15);
  }, [signedStudentIds, studentSearch, students, studentsLoaded]);

  const allProjectDataLoaded = signedStudentsLoaded && projectPaymentsLoaded;
  const allActionsDisabled = Boolean(activeMutation)
    || projectDataLoading
    || refreshing
    || !allProjectDataLoaded;

  const loadProjectCollections = useCallback(async () => {
    if (!projectId) return;

    const generation = projectLoadGeneration.current + 1;
    projectLoadGeneration.current = generation;
    setProjectDataLoading(true);
    setSignedStudentsError('');
    setProjectPaymentsError('');

    try {
      const [signedStudentsResult, projectPaymentsResult] = await Promise.allSettled([
        getDocsFromServer(collection(db, `projects/${projectId}/signedStudents`)),
        getDocsFromServer(collection(db, `projects/${projectId}/payments`)),
      ]);

      if (
        projectLoadGeneration.current !== generation
        || activeProjectId.current !== projectId
      ) {
        return;
      }

      if (signedStudentsResult.status === 'fulfilled') {
        setSignedStudents(sortSignedStudents(signedStudentsResult.value.docs.map(item => ({
          ...item.data(),
          id: item.id,
          studentId: item.data()?.studentId || item.id,
        }))));
        setSignedStudentsLoaded(true);
      } else {
        setSignedStudentsError(getErrorMessage(signedStudentsResult.reason));
        setSignedStudentsLoaded(false);
      }

      if (projectPaymentsResult.status === 'fulfilled') {
        setProjectPayments(sortProjectPayments(projectPaymentsResult.value.docs.map(item => ({
          ...item.data(),
          id: item.id,
          studentId: item.data()?.studentId || item.id,
        }))));
        setProjectPaymentsLoaded(true);
      } else {
        setProjectPaymentsError(getErrorMessage(projectPaymentsResult.reason));
        setProjectPaymentsLoaded(false);
      }

      if (
        signedStudentsResult.status === 'fulfilled'
        && projectPaymentsResult.status === 'fulfilled'
      ) {
        setProjectDataLoadedAt(Date.now());
      }
    } catch (error) {
      if (
        projectLoadGeneration.current === generation
        && activeProjectId.current === projectId
      ) {
        const message = getErrorMessage(error);
        setSignedStudentsError(message);
        setProjectPaymentsError(message);
        setSignedStudentsLoaded(false);
        setProjectPaymentsLoaded(false);
      }
      throw error;
    } finally {
      if (
        projectLoadGeneration.current === generation
        && activeProjectId.current === projectId
      ) {
        setProjectDataLoading(false);
      }
    }
  }, [db, projectId]);

  useEffect(() => {
    projectLoadGeneration.current += 1;
    setSignedStudents([]);
    setProjectPayments([]);
    setSignedStudentsLoaded(false);
    setProjectPaymentsLoaded(false);
    setSignedStudentsError('');
    setProjectPaymentsError('');
    setProjectDataLoadedAt(null);
    setProjectDataLoading(false);
    setStudentSearch('');
    setActionError('');
    setActionMessage('');
  }, [projectId]);

  useEffect(() => {
    if (!isStaff || !projectsLoaded || !project) return undefined;
    loadProjectCollections().catch(error => {
      console.error('Failed to load project details:', error);
    });

    return () => {
      projectLoadGeneration.current += 1;
    };
  }, [isStaff, loadProjectCollections, project, projectsLoaded]);

  const handleRefresh = async () => {
    if (
      refreshInProgress.current
      || mutationInProgress.current
      || !project
    ) return;

    refreshInProgress.current = true;
    setRefreshing(true);
    setActionError('');
    setActionMessage('');
    try {
      const results = await Promise.allSettled([
        loadProjectCollections(),
        refreshStudents(),
      ]);
      results.forEach(result => {
        if (result.status === 'rejected') {
          console.error('Failed to refresh a project data source:', result.reason);
        }
      });
    } finally {
      refreshInProgress.current = false;
      setRefreshing(false);
    }
  };

  const startMutation = (mutationKey) => {
    if (
      mutationInProgress.current
      || refreshInProgress.current
      || !allProjectDataLoaded
    ) return false;

    mutationInProgress.current = true;
    setActiveMutation(mutationKey);
    setActionError('');
    setActionMessage('');
    return true;
  };

  const finishMutation = () => {
    mutationInProgress.current = false;
    setActiveMutation('');
  };

  const handleSignStudent = async (student) => {
    if (!isStaff || !project || !student?.id) return;
    const mutationKey = `sign:${student.id}`;
    if (!startMutation(mutationKey)) return;

    const mutationProjectId = projectId;
    const projectRef = doc(db, 'projects', mutationProjectId);
    const memberRef = doc(db, `projects/${mutationProjectId}/signedStudents`, student.id);
    const signedAt = Timestamp.now();
    const memberData = {
      studentId: student.id,
      studentName: student.name || student.id,
      signedAt,
      signedBy: user?.id || '',
      signedByRole: user?.role || '',
    };

    try {
      await runTransaction(db, async transaction => {
        const projectSnapshot = await transaction.get(projectRef);
        const memberSnapshot = await transaction.get(memberRef);

        if (!projectSnapshot.exists()) {
          throw createProjectActionError('project-missing', 'This project no longer exists.');
        }
        if (memberSnapshot.exists()) {
          throw createProjectActionError('member-exists', 'This student is already signed up.');
        }

        const currentCount = getSignedStudentCount(
          projectSnapshot.data()?.signedStudentCount
        );
        transaction.set(memberRef, memberData);
        transaction.update(projectRef, { signedStudentCount: currentCount + 1 });
      });

      invalidateSalarySummaries();
      if (activeProjectId.current === mutationProjectId) {
        projectLoadGeneration.current += 1;
        setSignedStudents(current => sortSignedStudents([
          ...current.filter(item => (item.studentId || item.id) !== student.id),
          { id: student.id, ...memberData },
        ]));
        setStudentSearch('');
        setProjectDataLoadedAt(Date.now());
        setActionMessage(`${memberData.studentName} was signed up for this project.`);
      }
    } catch (error) {
      console.error('Failed to sign student up for project:', error);
      if (activeProjectId.current === mutationProjectId) {
        setActionError(getErrorMessage(error));
      }
    } finally {
      finishMutation();
    }
  };

  const handleUnsignStudent = async (member) => {
    if (!isStaff || !project || !member?.studentId) return;
    const studentId = member.studentId;
    const existingPayments = getProjectPaymentsForStudent(projectPayments, studentId);
    if (existingPayments.length > 0) {
      setActionError('Delete this student\'s project payment before removing them.');
      return;
    }
    if (!window.confirm(`Remove ${member.studentName || studentId} from this project?`)) {
      return;
    }

    const mutationKey = `unsign:${studentId}`;
    if (!startMutation(mutationKey)) return;

    const mutationProjectId = projectId;
    const projectRef = doc(db, 'projects', mutationProjectId);
    const memberRef = doc(db, `projects/${mutationProjectId}/signedStudents`, studentId);
    const paymentRefs = [
      studentId,
      `${studentId}--full`,
      `${studentId}--first_half`,
      `${studentId}--second_half`,
    ].map(paymentId => doc(db, `projects/${mutationProjectId}/payments`, paymentId));

    try {
      await runTransaction(db, async transaction => {
        const projectSnapshot = await transaction.get(projectRef);
        const memberSnapshot = await transaction.get(memberRef);
        const paymentSnapshots = await Promise.all(
          paymentRefs.map(paymentRef => transaction.get(paymentRef))
        );

        if (!projectSnapshot.exists()) {
          throw createProjectActionError('project-missing', 'This project no longer exists.');
        }
        if (!memberSnapshot.exists()) {
          throw createProjectActionError('member-missing', 'This student is no longer signed up.');
        }
        if (paymentSnapshots.some(snapshot => snapshot.exists())) {
          throw createProjectActionError(
            'payment-exists',
            'Delete this student\'s project payment before removing them.'
          );
        }

        const currentCount = getSignedStudentCount(
          projectSnapshot.data()?.signedStudentCount
        );
        transaction.delete(memberRef);
        transaction.update(projectRef, {
          signedStudentCount: Math.max(0, currentCount - 1),
        });
      });

      invalidateSalarySummaries();
      if (activeProjectId.current === mutationProjectId) {
        projectLoadGeneration.current += 1;
        setSignedStudents(current => current.filter(
          item => (item.studentId || item.id) !== studentId
        ));
        setProjectDataLoadedAt(Date.now());
        setActionMessage(`${member.studentName || studentId} was removed from this project.`);
      }
    } catch (error) {
      console.error('Failed to remove student from project:', error);
      if (activeProjectId.current === mutationProjectId) {
        setActionError(getErrorMessage(error));
      }
    } finally {
      finishMutation();
    }
  };

  const openPaymentForm = (member) => {
    if (!isStaff || !member?.studentId) return;
    const returnTo = encodeURIComponent(`/project/${projectId}`);
    navigate(
      `/add-payment?mode=project&projectId=${encodeURIComponent(projectId)}` +
      `&studentId=${encodeURIComponent(member.studentId)}&returnTo=${returnTo}`
    );
  };

  const handleDeleteProjectPayment = async payment => {
    if (!isAdmin || !project || !payment?.studentId) return;
    if (!window.confirm(`Delete the project payment for ${payment.studentName || payment.studentId}?`)) {
      return;
    }

    const studentId = payment.studentId;
    const paymentId = payment.id || studentId;
    const mutationKey = `payment:delete:${paymentId}`;
    if (!startMutation(mutationKey)) return;

    const mutationProjectId = projectId;
    const projectRef = doc(db, 'projects', mutationProjectId);
    const paymentRef = doc(db, `projects/${mutationProjectId}/payments`, paymentId);

    try {
      await runTransaction(db, async transaction => {
        const projectSnapshot = await transaction.get(projectRef);
        const paymentSnapshot = await transaction.get(paymentRef);

        if (!projectSnapshot.exists()) {
          throw createProjectActionError('project-missing', 'This project no longer exists.');
        }
        if (!paymentSnapshot.exists()) {
          throw createProjectActionError('payment-missing', 'This payment was already deleted.');
        }

        transaction.delete(paymentRef);
      });

      invalidateSalarySummaries();
      invalidateProjectPaymentHistory();
      if (activeProjectId.current === mutationProjectId) {
        projectLoadGeneration.current += 1;
        setProjectPayments(current => current.filter(
          item => item.id !== paymentId
        ));
        setProjectDataLoadedAt(Date.now());
        setActionMessage(`Payment for ${payment.studentName || studentId} was deleted.`);
      }
    } catch (error) {
      console.error('Failed to delete project payment:', error);
      if (activeProjectId.current === mutationProjectId) {
        setActionError(getErrorMessage(error));
      }
    } finally {
      finishMutation();
    }
  };

  const projectSourceError = [
    projectsError ? `Project: ${getErrorMessage(projectsError)}` : '',
    signedStudentsError ? `Roster: ${signedStudentsError}` : '',
    projectPaymentsError ? `Payments: ${projectPaymentsError}` : '',
    studentsError ? `Students: ${getErrorMessage(studentsError)}` : '',
  ].filter(Boolean).join(' · ');
  const loadedMessage = projectDataLoadedAt
    ? `Updated ${new Date(projectDataLoadedAt).toLocaleString()}${
        studentsLastLoadedAt
          ? ` · Students ${new Date(studentsLastLoadedAt).toLocaleString()}`
          : ''
      }`
    : 'Project roster and payments have not been loaded yet.';

  if (!isStaff) {
    return (
      <main className="project-detail-page">
        <div className="project-detail-shell project-detail-state">
          <h1>Project</h1>
          <p>Only admins and coaches can view project details.</p>
          <button type="button" onClick={() => navigate('/groups')}>Back to groups</button>
        </div>
      </main>
    );
  }

  if (!projectsLoaded && !project) {
    return (
      <main className="project-detail-page">
        <div className="project-detail-shell project-detail-state" role="status">
          <span className="project-detail-spinner" aria-hidden="true" />
          <h1>Loading project…</h1>
        </div>
      </main>
    );
  }

  if (!project) {
    return (
      <main className="project-detail-page">
        <div className="project-detail-shell project-detail-state">
          <h1>Project not found</h1>
          <p role={projectsError ? 'alert' : undefined}>
            {projectsError
              ? `The project list could not be loaded: ${getErrorMessage(projectsError)}`
              : 'This project may have been removed.'}
          </p>
          <button type="button" onClick={() => navigate('/groups')}>Back to groups</button>
        </div>
      </main>
    );
  }

  const rosterCount = signedStudentsLoaded
    ? displayedSignedStudents.length
    : getSignedStudentCount(project.signedStudentCount);

  return (
    <main className="project-detail-page">
      <div className="project-detail-shell">
        <header className="project-detail-header">
          <button
            type="button"
            className="project-detail-back"
            onClick={() => navigate('/groups')}
            aria-label="Back to groups"
          >
            <span aria-hidden="true">‹</span>
            Back
          </button>
          <div className="project-detail-heading">
            <div className="project-detail-badges">
              <span className={`project-status project-status--${projectStatus}`}>
                {PROJECT_STATUS_LABELS[projectStatus] || projectStatus}
              </span>
              {project.hidden === true && <span className="project-status project-status--hidden">Hidden</span>}
            </div>
            <p>Project group</p>
            <h1>{project.name || 'Untitled project'}</h1>
          </div>
        </header>

        <RefreshStatus
          message={loadedMessage}
          error={projectSourceError}
          loading={projectDataLoading || refreshing || studentsLoading}
          onRefresh={handleRefresh}
          disabled={Boolean(activeMutation)}
          refreshLabel={projectSourceError ? 'Try again' : 'Refresh project'}
          loadingLabel="Refreshing…"
          className="project-detail-refresh"
        />

        <section className="project-overview-card" aria-labelledby="project-overview-title">
          <div className="project-section-heading">
            <div>
              <p>Overview</p>
              <h2 id="project-overview-title">Project details</h2>
            </div>
            <strong className="project-price">{formatMoney(project.price)}</strong>
          </div>
          <dl className="project-metadata-grid">
            <div>
              <dt>Dates</dt>
              <dd>{formatProjectDate(project.startDate) || '—'} – {formatProjectDate(project.endDate) || '—'}</dd>
            </div>
            <div>
              <dt>Coach</dt>
              <dd>{coachName}</dd>
            </div>
            <div>
              <dt>Classes</dt>
              <dd>{totalClasses || '—'}</dd>
            </div>
            <div>
              <dt>Signed people</dt>
              <dd>{rosterCount}</dd>
            </div>
          </dl>
          <div className="project-weekly-slots" aria-label="Weekly schedule">
            {(project.scheduleSlots || []).map((slot, index) => (
              <span key={`${slot.dayOfWeek}-${slot.time}-${index}`}>
                {DAY_NAMES[Number(slot.dayOfWeek)] || 'Day'} · {slot.time || 'Time TBA'}
              </span>
            ))}
          </div>
        </section>

        <section className="project-schedule-card" aria-labelledby="project-schedule-title">
          <div className="project-section-heading project-schedule-heading">
            <div>
              <p>Fixed schedule</p>
              <h2 id="project-schedule-title">Classes</h2>
            </div>
            <strong>{elapsedClasses}/{totalClasses || generatedSchedule.length}</strong>
          </div>
          <div className="project-progress-copy">
            <span>{elapsedClasses} scheduled {elapsedClasses === 1 ? 'date has' : 'dates have'} passed</span>
            {todayClasses > 0 && <span>{todayClasses} {todayClasses === 1 ? 'class' : 'classes'} today</span>}
          </div>
          <div
            className="project-progress-track"
            role="progressbar"
            aria-label="Project schedule progress"
            aria-valuemin="0"
            aria-valuemax={totalClasses || generatedSchedule.length || 1}
            aria-valuenow={elapsedClasses}
          >
            <span style={{ width: `${progressPercent}%` }} />
          </div>
          {generatedSchedule.length === 0 ? (
            <p className="project-empty-message">No valid fixed schedule could be generated.</p>
          ) : (
            <ol className="project-schedule-list">
              {generatedSchedule.map(session => {
                const scheduleState = session.isoDate < todayIso
                  ? 'elapsed'
                  : session.isoDate === todayIso
                    ? 'today'
                    : 'upcoming';
                return (
                  <li key={`${session.isoDate}-${session.time}`} className={`is-${scheduleState}`}>
                    <span className="project-class-number">{session.index}</span>
                    <span>
                      <strong>{DAY_NAMES[session.dayOfWeek]}</strong>
                      <time dateTime={`${session.isoDate}T${session.time}`}>
                        {session.date} · {session.time}
                      </time>
                    </span>
                    <small>
                      {scheduleState === 'elapsed'
                        ? 'Passed'
                        : scheduleState === 'today'
                          ? 'Today'
                          : 'Upcoming'}
                    </small>
                  </li>
                );
              })}
            </ol>
          )}
          {totalClasses > 0 && generatedSchedule.length < totalClasses && (
            <p className="project-inline-warning" role="alert">
              Only {generatedSchedule.length} of {totalClasses} fixed classes fit this date range.
            </p>
          )}
        </section>

        <section className="project-roster-card" aria-labelledby="project-roster-title">
          <div className="project-section-heading">
            <div>
              <p>Enrollment</p>
              <h2 id="project-roster-title">Signed roster</h2>
            </div>
            <strong>{rosterCount}</strong>
          </div>

          <div className="project-student-search">
            <label htmlFor="project-student-search">Sign a student from the list</label>
            <input
              id="project-student-search"
              type="search"
              value={studentSearch}
              onChange={event => setStudentSearch(event.target.value)}
              placeholder="Search by name, phone, or ID"
              disabled={!studentsLoaded || studentsLoading || allActionsDisabled}
              autoComplete="off"
            />
            {!studentsLoaded && (
              <p className="project-field-help" role="status">
                {studentsLoading ? 'Loading the student list…' : 'Refresh to load the student list.'}
              </p>
            )}
            {studentsLoaded && studentSearch.trim() && (
              <ul className="project-search-results" aria-label="Students available to sign">
                {availableStudentMatches.length === 0 ? (
                  <li className="project-search-empty">No unsigned students match this search.</li>
                ) : availableStudentMatches.map(student => {
                  const mutationKey = `sign:${student.id}`;
                  return (
                    <li key={student.id}>
                      <span>
                        <strong>{student.name || student.id}</strong>
                        <small>{student.phone || student.id}</small>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleSignStudent(student)}
                        disabled={allActionsDisabled}
                      >
                        {getMutationLabel(activeMutation, mutationKey, 'Signing…', 'Sign')}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {actionError && <p className="project-action-message is-error" role="alert">{actionError}</p>}
          {actionMessage && <p className="project-action-message is-success" role="status">{actionMessage}</p>}

          {!signedStudentsLoaded && projectDataLoading ? (
            <p className="project-empty-message" role="status">Loading signed students…</p>
          ) : !signedStudentsLoaded ? (
            <p className="project-empty-message" role="alert">
              The signed roster is unavailable. Refresh the project to try again.
            </p>
          ) : signedStudentsLoaded && displayedSignedStudents.length === 0 ? (
            <p className="project-empty-message">No one is signed up yet.</p>
          ) : (
            <ul className="project-roster-list">
              {displayedSignedStudents.map(member => {
                const paymentStatusKnown = projectPaymentsLoaded;
                const paymentProgress = getProjectPaymentProgress(
                  projectPayments,
                  member.studentId,
                  project.price
                );
                const availablePaymentParts = getAvailableProjectPaymentParts(
                  projectPayments,
                  member.studentId
                );
                const unsignMutationKey = `unsign:${member.studentId}`;
                return (
                  <li key={member.studentId}>
                    <div className="project-roster-person">
                      <span className="project-person-avatar" aria-hidden="true">
                        {String(member.studentName || '?').trim().charAt(0).toUpperCase() || '?'}
                      </span>
                      <span>
                        <strong>{member.studentName}</strong>
                        <small>
                          {!paymentStatusKnown
                            ? 'Payment status unavailable'
                            : paymentProgress.complete
                              ? `Paid in full · ${formatMoney(paymentProgress.paidAmount)}`
                              : paymentProgress.hasPayment
                                ? `50% paid · ${formatMoney(paymentProgress.paidAmount)}`
                              : 'Payment pending'}
                        </small>
                      </span>
                    </div>
                    <span className={`project-payment-state ${
                      !paymentStatusKnown
                        ? 'is-unknown'
                        : paymentProgress.complete
                          ? 'is-paid'
                          : 'is-unpaid'
                    }`}>
                      {!paymentStatusKnown
                        ? 'Unknown'
                        : paymentProgress.complete
                          ? 'Paid'
                          : paymentProgress.hasPayment
                            ? '50% paid'
                            : 'Unpaid'}
                    </span>
                    <div className="project-roster-actions">
                      {paymentStatusKnown && availablePaymentParts.length > 0 && (
                        <button
                          type="button"
                          className="project-small-button is-primary"
                          onClick={() => openPaymentForm(member)}
                          disabled={allActionsDisabled}
                        >
                          {paymentProgress.hasPayment ? 'Add second 50%' : 'Add payment'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="project-small-button is-muted"
                        onClick={() => handleUnsignStudent(member)}
                        disabled={allActionsDisabled || paymentProgress.hasPayment}
                        title={paymentProgress.hasPayment
                          ? 'Delete all project payments before removing this student'
                          : 'Remove from project'}
                      >
                        {getMutationLabel(activeMutation, unsignMutationKey, 'Removing…', 'Remove')}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="project-payments-card" aria-labelledby="project-payments-title">
          <div className="project-section-heading">
            <div>
              <p>Stored only in this project</p>
              <h2 id="project-payments-title">Payment history</h2>
            </div>
            <strong>{sortedPayments.length}</strong>
          </div>
          {!projectPaymentsLoaded && projectDataLoading ? (
            <p className="project-empty-message" role="status">Loading project payments…</p>
          ) : !projectPaymentsLoaded ? (
            <p className="project-empty-message" role="alert">
              Project payments are unavailable. Refresh the project to try again.
            </p>
          ) : projectPaymentsLoaded && sortedPayments.length === 0 ? (
            <p className="project-empty-message">No project payments have been recorded.</p>
          ) : (
            <ul className="project-payments-list">
              {sortedPayments.map(payment => {
                const currentStudent = studentsById.get(payment.studentId);
                const studentName = currentStudent?.name || payment.studentName || payment.studentId;
                const deleteMutationKey = `payment:delete:${payment.id || payment.studentId}`;
                return (
                  <li key={payment.id || payment.studentId}>
                    <div className="project-payment-main">
                      <span className="project-payment-icon" aria-hidden="true">€</span>
                      <span>
                        <strong>{studentName}</strong>
                        <small>
                          {payment.createdAt || 'Date unknown'} · {getPaymentMethodLabel(payment.paymentMethod)}
                          {' · '}
                          {PROJECT_PAYMENT_PART_LABELS[payment.paymentPart] || 'Full payment'}
                        </small>
                      </span>
                    </div>
                    <div className="project-payment-amount">
                      <strong>{formatMoney(payment.amount)}</strong>
                      <small>Recorded by {payment.recordedByRole || 'staff'}</small>
                    </div>
                    {isAdmin && (
                      <button
                        type="button"
                        className="project-delete-payment"
                        onClick={() => handleDeleteProjectPayment(payment)}
                        disabled={allActionsDisabled}
                        aria-label={`Delete project payment for ${studentName}`}
                      >
                        {activeMutation === deleteMutationKey ? 'Deleting…' : 'Delete'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

export default ProjectDetailPage;
