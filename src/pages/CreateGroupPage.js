import React, { useMemo, useRef, useState } from 'react';
import { addDoc, collection, Timestamp } from 'firebase/firestore';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import {
  generateProjectSchedule,
  validateProjectSchedule,
} from '../utils/projectUtils';
import { invalidateSalarySummaries } from '../utils/salaryCache';
import './CreateGroupPage.css';

const WEEKDAYS = [
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
];

const EMPTY_SLOTS = [
  { dayOfWeek: '1', time: '' },
  { dayOfWeek: '4', time: '' },
];
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function asPositiveNumber(value) {
  const number = Number(String(value || '').replace(',', '.'));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function asPositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function scheduleLabel(slots) {
  return slots
    .map(slot => `${WEEKDAYS[slot.dayOfWeek]} ${slot.time}`)
    .join(' / ');
}

function CreateGroupPage() {
  const { db, coaches = [], coachesLoaded } = useData();
  const { user } = useUser();
  const navigate = useNavigate();
  const location = useLocation();
  const requestedKind = new URLSearchParams(location.search).get('kind');

  const [kind, setKind] = useState(requestedKind === 'project' ? 'project' : 'regular');
  const [name, setName] = useState('');
  const [coachId, setCoachId] = useState('');
  const [hidden, setHidden] = useState(false);

  const [regularType, setRegularType] = useState('CLOSED');
  const [regularDay, setRegularDay] = useState('1');
  const [regularTime, setRegularTime] = useState('');

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [totalClasses, setTotalClasses] = useState('');
  const [price, setPrice] = useState('');
  const [frequency, setFrequency] = useState('1');
  const [scheduleSlots, setScheduleSlots] = useState(EMPTY_SLOTS);

  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionInProgress = useRef(false);

  const sortedCoaches = useMemo(
    () => [...coaches].sort((first, second) => (
      String(first.name || first.email || first.id).localeCompare(
        String(second.name || second.email || second.id)
      )
    )),
    [coaches]
  );

  const activeScheduleSlots = useMemo(
    () => scheduleSlots.slice(0, Number(frequency)).map(slot => ({
      dayOfWeek: Number(slot.dayOfWeek),
      time: slot.time,
    })),
    [frequency, scheduleSlots]
  );

  const projectDraft = useMemo(() => ({
    startDate,
    endDate,
    totalClasses,
    scheduleSlots: activeScheduleSlots,
  }), [activeScheduleSlots, endDate, startDate, totalClasses]);

  const generatedClasses = useMemo(
    () => generateProjectSchedule(projectDraft),
    [projectDraft]
  );

  const previewIsReady = Boolean(
    startDate &&
    endDate &&
    totalClasses &&
    activeScheduleSlots.every(slot => slot.time)
  );
  const previewError = previewIsReady ? validateProjectSchedule(projectDraft) : '';
  const visiblePreview = generatedClasses.length <= 9
    ? generatedClasses
    : [...generatedClasses.slice(0, 8), generatedClasses[generatedClasses.length - 1]];

  const clearError = (field) => {
    setErrors(current => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setSubmitError('');
  };

  const updateScheduleSlot = (index, field, value) => {
    setScheduleSlots(current => current.map((slot, slotIndex) => (
      slotIndex === index ? { ...slot, [field]: value } : slot
    )));
    clearError('schedule');
  };

  const selectKind = (nextKind) => {
    if (isSubmitting) return;
    setKind(nextKind);
    setErrors({});
    setSubmitError('');
  };

  const validate = () => {
    const nextErrors = {};
    const trimmedName = name.trim();

    if (!trimmedName) nextErrors.name = 'Enter a name.';
    if (!coachId) nextErrors.coach = 'Select a coach.';
    if (!coachesLoaded) nextErrors.coach = 'Wait for coaches to finish loading.';

    if (kind === 'regular') {
      if (!['CLOSED', 'OPEN'].includes(regularType)) {
        nextErrors.type = 'Select a valid group type.';
      }
      if (!/^[0-6]$/.test(regularDay)) {
        nextErrors.schedule = 'Select a weekday.';
      }
      if (!TIME_PATTERN.test(regularTime)) nextErrors.schedule = 'Select a valid class time.';
    } else {
      if (!startDate) nextErrors.startDate = 'Select a start date.';
      if (!endDate) nextErrors.endDate = 'Select an end date.';
      if (asPositiveInteger(totalClasses) === null) {
        nextErrors.totalClasses = 'Enter a positive whole number.';
      }
      if (asPositiveNumber(price) === null) {
        nextErrors.price = 'Enter an amount greater than zero.';
      }

      const projectScheduleError = validateProjectSchedule(projectDraft);
      if (projectScheduleError) nextErrors.schedule = projectScheduleError;
    }

    setErrors(nextErrors);
    return {
      isValid: Object.keys(nextErrors).length === 0,
      trimmedName,
    };
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submissionInProgress.current) return;

    const validation = validate();
    if (!validation.isValid) return;

    submissionInProgress.current = true;
    setIsSubmitting(true);
    setSubmitError('');

    try {
      const createdAt = Timestamp.now();
      const createdBy = user.id || user.email || '';

      if (kind === 'regular') {
        const dayOfWeek = Number(regularDay);
        const groupRef = await addDoc(collection(db, 'groups'), {
          name: validation.trimmedName,
          type: regularType,
          dayOfWeek,
          time: regularTime,
          schedule: `${WEEKDAYS[dayOfWeek]} ${regularTime}`,
          coach: coachId,
          signedStudents: [],
          hidden,
          createdAt,
          createdBy,
        });
        invalidateSalarySummaries();
        navigate(`/group/${groupRef.id}`);
        return;
      }

      const projectRef = await addDoc(collection(db, 'projects'), {
        name: validation.trimmedName,
        type: 'PROJECT',
        startDate,
        endDate,
        totalClasses: asPositiveInteger(totalClasses),
        price: asPositiveNumber(price),
        scheduleSlots: activeScheduleSlots,
        schedule: scheduleLabel(activeScheduleSlots),
        coach: coachId,
        hidden,
        signedStudentCount: 0,
        createdAt,
        createdBy,
      });
      invalidateSalarySummaries();
      navigate(`/project/${projectRef.id}`);
    } catch (error) {
      console.error('Failed to create group:', error);
      setSubmitError(
        kind === 'project'
          ? 'The project could not be created. Nothing was saved.'
          : 'The group could not be created. Nothing was saved.'
      );
    } finally {
      submissionInProgress.current = false;
      setIsSubmitting(false);
    }
  };

  if (user?.role !== 'admin') {
    return <Navigate to="/groups" replace />;
  }

  return (
    <main className="create-group-page">
      <div className="create-group-shell">
        <header className="create-group-header">
          <button
            type="button"
            className="create-group-back"
            onClick={() => navigate('/groups')}
            disabled={isSubmitting}
          >
            ← Groups
          </button>
          <div>
            <p>ADMIN</p>
            <h1>Create</h1>
          </div>
        </header>

        <div className="create-group-kind" role="group" aria-label="Create type">
          <button
            type="button"
            className={kind === 'regular' ? 'is-active' : ''}
            aria-pressed={kind === 'regular'}
            onClick={() => selectKind('regular')}
            disabled={isSubmitting}
          >
            Regular group
          </button>
          <button
            type="button"
            className={kind === 'project' ? 'is-active' : ''}
            aria-pressed={kind === 'project'}
            onClick={() => selectKind('project')}
            disabled={isSubmitting}
          >
            Project
          </button>
        </div>

        <form className="create-group-form" onSubmit={handleSubmit} noValidate>
          <section className="create-group-card" aria-labelledby="create-basics-title">
            <h2 id="create-basics-title">Basics</h2>

            <label className={errors.name ? 'has-error' : ''}>
              <span>Name</span>
              <input
                type="text"
                value={name}
                onChange={event => {
                  setName(event.target.value);
                  clearError('name');
                }}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? 'create-name-error' : undefined}
                autoComplete="off"
                disabled={isSubmitting}
              />
              {errors.name && <small id="create-name-error" role="alert">{errors.name}</small>}
            </label>

            <label className={errors.coach ? 'has-error' : ''}>
              <span>Coach</span>
              <select
                value={coachId}
                onChange={event => {
                  setCoachId(event.target.value);
                  clearError('coach');
                }}
                aria-invalid={Boolean(errors.coach)}
                aria-describedby={errors.coach ? 'create-coach-error' : undefined}
                disabled={isSubmitting || !coachesLoaded}
              >
                <option value="">
                  {coachesLoaded ? 'Select coach' : 'Loading coaches…'}
                </option>
                {sortedCoaches.map(coach => (
                  <option key={coach.id} value={coach.id}>
                    {coach.name || coach.email || coach.id}
                  </option>
                ))}
              </select>
              {errors.coach && <small id="create-coach-error" role="alert">{errors.coach}</small>}
            </label>
          </section>

          {kind === 'regular' ? (
            <section className="create-group-card" aria-labelledby="regular-settings-title">
              <h2 id="regular-settings-title">Regular group</h2>

              <label className={errors.type ? 'has-error' : ''}>
                <span>Type</span>
                <select
                  value={regularType}
                  onChange={event => {
                    setRegularType(event.target.value);
                    clearError('type');
                  }}
                  disabled={isSubmitting}
                >
                  <option value="CLOSED">Closed</option>
                  <option value="OPEN">Open</option>
                </select>
                {errors.type && <small role="alert">{errors.type}</small>}
              </label>

              <div className={`create-group-grid ${errors.schedule ? 'has-error' : ''}`}>
                <label>
                  <span>Weekday</span>
                  <select
                    value={regularDay}
                    onChange={event => {
                      setRegularDay(event.target.value);
                      clearError('schedule');
                    }}
                    aria-invalid={Boolean(errors.schedule)}
                    aria-describedby={errors.schedule ? 'regular-schedule-error' : undefined}
                    disabled={isSubmitting}
                  >
                    {WEEKDAYS.map((day, index) => (
                      <option key={day} value={index}>{day}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Time</span>
                  <input
                    type="time"
                    value={regularTime}
                    onChange={event => {
                      setRegularTime(event.target.value);
                      clearError('schedule');
                    }}
                    aria-invalid={Boolean(errors.schedule)}
                    aria-describedby={errors.schedule ? 'regular-schedule-error' : undefined}
                    disabled={isSubmitting}
                  />
                </label>
              </div>
              {errors.schedule && (
                <small id="regular-schedule-error" className="create-group-section-error" role="alert">
                  {errors.schedule}
                </small>
              )}
            </section>
          ) : (
            <>
              <section className="create-group-card" aria-labelledby="project-dates-title">
                <h2 id="project-dates-title">Project dates & price</h2>

                <div className="create-group-grid">
                  <label className={errors.startDate ? 'has-error' : ''}>
                    <span>Starts</span>
                    <input
                      type="date"
                      value={startDate}
                      onChange={event => {
                        setStartDate(event.target.value);
                        clearError('startDate');
                        clearError('schedule');
                      }}
                      aria-invalid={Boolean(errors.startDate)}
                      aria-describedby={errors.startDate ? 'project-start-error' : undefined}
                      disabled={isSubmitting}
                    />
                    {errors.startDate && <small id="project-start-error" role="alert">{errors.startDate}</small>}
                  </label>
                  <label className={errors.endDate ? 'has-error' : ''}>
                    <span>Ends</span>
                    <input
                      type="date"
                      value={endDate}
                      min={startDate || undefined}
                      onChange={event => {
                        setEndDate(event.target.value);
                        clearError('endDate');
                        clearError('schedule');
                      }}
                      aria-invalid={Boolean(errors.endDate)}
                      aria-describedby={errors.endDate ? 'project-end-error' : undefined}
                      disabled={isSubmitting}
                    />
                    {errors.endDate && <small id="project-end-error" role="alert">{errors.endDate}</small>}
                  </label>
                </div>

                <div className="create-group-grid">
                  <label className={errors.totalClasses ? 'has-error' : ''}>
                    <span>Classes</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      inputMode="numeric"
                      value={totalClasses}
                      onChange={event => {
                        setTotalClasses(event.target.value);
                        clearError('totalClasses');
                        clearError('schedule');
                      }}
                      aria-invalid={Boolean(errors.totalClasses)}
                      aria-describedby={errors.totalClasses ? 'project-classes-error' : undefined}
                      disabled={isSubmitting}
                    />
                    {errors.totalClasses && <small id="project-classes-error" role="alert">{errors.totalClasses}</small>}
                  </label>
                  <label className={errors.price ? 'has-error' : ''}>
                    <span>Price per student (€)</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={price}
                      onChange={event => {
                        setPrice(event.target.value);
                        clearError('price');
                      }}
                      aria-invalid={Boolean(errors.price)}
                      aria-describedby={errors.price ? 'project-price-error' : undefined}
                      disabled={isSubmitting}
                    />
                    {errors.price && <small id="project-price-error" role="alert">{errors.price}</small>}
                  </label>
                </div>
              </section>

              <section className="create-group-card" aria-labelledby="project-schedule-title">
                <div className="create-group-card-heading">
                  <h2 id="project-schedule-title">Weekly schedule</h2>
                  <label>
                    <span className="sr-only">Classes per week</span>
                    <select
                      value={frequency}
                      onChange={event => {
                        setFrequency(event.target.value);
                        clearError('schedule');
                      }}
                      disabled={isSubmitting}
                      aria-label="Classes per week"
                      aria-invalid={Boolean(errors.schedule)}
                      aria-describedby={errors.schedule ? 'project-schedule-error' : undefined}
                    >
                      <option value="1">Once a week</option>
                      <option value="2">Twice a week</option>
                    </select>
                  </label>
                </div>

                {activeScheduleSlots.map((slot, index) => (
                  <fieldset className="create-schedule-slot" key={index}>
                    <legend>Class {index + 1}</legend>
                    <label>
                      <span>Weekday</span>
                      <select
                        value={scheduleSlots[index].dayOfWeek}
                        onChange={event => updateScheduleSlot(index, 'dayOfWeek', event.target.value)}
                        aria-invalid={Boolean(errors.schedule)}
                        aria-describedby={errors.schedule ? 'project-schedule-error' : undefined}
                        disabled={isSubmitting}
                      >
                        {WEEKDAYS.map((day, dayIndex) => (
                          <option key={day} value={dayIndex}>{day}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Time</span>
                      <input
                        type="time"
                        value={slot.time}
                        onChange={event => updateScheduleSlot(index, 'time', event.target.value)}
                        aria-invalid={Boolean(errors.schedule)}
                        aria-describedby={errors.schedule ? 'project-schedule-error' : undefined}
                        disabled={isSubmitting}
                      />
                    </label>
                  </fieldset>
                ))}
                {errors.schedule && (
                  <small id="project-schedule-error" className="create-group-section-error" role="alert">
                    {errors.schedule}
                  </small>
                )}
              </section>

              <section className="create-group-card create-preview" aria-labelledby="project-preview-title">
                <div className="create-group-card-heading">
                  <h2 id="project-preview-title">Class preview</h2>
                  <span>{generatedClasses.length}/{totalClasses || 0}</span>
                </div>

                <div aria-live="polite">
                  {!previewIsReady && (
                    <p className="create-preview-message">Complete the dates, class count, and weekly schedule.</p>
                  )}
                  {previewIsReady && previewError && (
                    <p className="create-preview-error" role="alert">{previewError}</p>
                  )}
                  {previewIsReady && !previewError && (
                    <ol className="create-preview-list">
                      {visiblePreview.map((classItem, index) => (
                        <React.Fragment key={`${classItem.isoDate}-${classItem.time}`}>
                          {generatedClasses.length > 9 && index === visiblePreview.length - 1 && (
                            <li className="create-preview-gap" aria-hidden="true">…</li>
                          )}
                          <li>
                            <span>{classItem.date}</span>
                            <strong>{WEEKDAYS[classItem.dayOfWeek]} · {classItem.time}</strong>
                          </li>
                        </React.Fragment>
                      ))}
                    </ol>
                  )}
                </div>
              </section>
            </>
          )}

          <label className="create-group-hidden">
            <input
              type="checkbox"
              checked={hidden}
              onChange={event => setHidden(event.target.checked)}
              disabled={isSubmitting}
            />
            <span>Hide from regular lists</span>
          </label>

          {submitError && <p className="create-group-submit-error" role="alert">{submitError}</p>}

          <button
            type="submit"
            className="create-group-submit"
            disabled={isSubmitting || !coachesLoaded}
          >
            {isSubmitting
              ? 'Creating…'
              : kind === 'project'
                ? 'Create project'
                : 'Create regular group'}
          </button>
        </form>
      </div>
    </main>
  );
}

export default CreateGroupPage;
