import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../context/firebase';
import {
  collection,
  Timestamp,
  doc,
  arrayUnion,
  getDocsFromServer,
  runTransaction,
  writeBatch, // <-- atomic writes
} from 'firebase/firestore';
import { useNavigate, useLocation } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import { invalidateSalarySummaries } from '../utils/salaryCache';
import {
  formatEuropeanDate,
  getOtherPaymentMonth,
  OTHER_PAYMENT_REASONS,
} from '../utils/otherPaymentsUtils';
import { invalidateOtherPaymentHistory } from '../utils/otherPaymentsCache';
import { invalidateProjectPaymentHistory } from '../utils/projectPaymentsCache';
import { invalidateWorkshopPaymentHistory } from '../utils/workshopPaymentsCache';
import { PAYMENT_METHODS } from '../utils/paymentMethodUtils';
import {
  getAvailableProjectPaymentParts,
  getProjectPaymentAmount,
  getProjectPaymentDocId,
  PROJECT_PAYMENT_PART_LABELS,
} from '../utils/projectPaymentUtils';
import RefreshStatus from '../components/RefreshStatus';
import GradientActionButton from '../components/GradientActionButton';
import './AddPaymentPage.css';

function AddPaymentPage() {
  const {
    students,
    groups,
    projects = [],
    workshops = [],
    db,
    studentsLoaded,
    studentsLoading,
    studentsError,
    studentsLastLoadedAt,
    refreshStudents,
    upsertPayment,
    patchStudent,
  } = useData();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useUser();
  const isCoach = user?.role === 'coach';

  const [paymentMode, setPaymentMode] = useState('group');
  const [paymentMethod, setPaymentMethod] = useState(isCoach ? 'cash' : 'card');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [amount, setAmount] = useState('');
  const [type, setType] = useState('');
  const [discount, setDiscount] = useState('0');
  const [startDate, setStartDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [paidDate, setPaidDate] = useState('');
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [reason, setReason] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedWorkshopId, setSelectedWorkshopId] = useState('');
  const [workshopPayments, setWorkshopPayments] = useState([]);
  const [projectMembers, setProjectMembers] = useState([]);
  const [projectPayments, setProjectPayments] = useState([]);
  const [projectPaymentPart, setProjectPaymentPart] = useState('');
  const [projectDataLoading, setProjectDataLoading] = useState(false);
  const [projectDataError, setProjectDataError] = useState('');
  const [projectDataLoadedAt, setProjectDataLoadedAt] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false); // <-- prevent double-clicks
  const [errors, setErrors] = useState({});
  const appliedPrefillQuery = useRef(null);
  const submissionInProgress = useRef(false);
  const projectLoadGeneration = useRef(0);

  useEffect(() => {
    if (!isCoach) return;
    setPaymentMethod('cash');
  }, [isCoach]);

  const clearError = (field) => {
    setErrors(current => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const selectedProject = projects.find(project => project.id === selectedProjectId) || null;
  const selectedWorkshop = workshops.find(workshop => workshop.id === selectedWorkshopId) || null;
  const projectMemberIds = useMemo(
    () => new Set(projectMembers.map(member => member.studentId || member.id)),
    [projectMembers]
  );
  const paidWorkshopStudentIds = useMemo(
    () => new Set(workshopPayments.filter(payment => payment.status === 'active').map(payment => payment.studentId)),
    [workshopPayments]
  );
  const paymentStudentSource = paymentMode === 'project'
    ? students.filter(student => projectMemberIds.has(student.id))
    : paymentMode === 'workshop'
      ? students.filter(student => !paidWorkshopStudentIds.has(student.id))
    : students;
  const filteredStudents = paymentStudentSource.filter(s =>
    String(s.name || '').toLowerCase().includes(searchTerm.toLowerCase())
  );
  const sortedGroups = groups
    .filter(group => group.hidden !== true)
    .sort((b, a) => a.name.localeCompare(b.name));
  const openPaymentGroups = sortedGroups.filter(group => String(group.type || '').toUpperCase() === 'OPEN');
  const closedPaymentGroups = sortedGroups.filter(group => String(group.type || '').toUpperCase() !== 'OPEN');
  const sortedProjects = projects
    .filter(project => project.hidden !== true)
    .sort((first, second) => String(first.name || '').localeCompare(String(second.name || '')));
  const sortedWorkshops = workshops
    .filter(workshop => workshop.hidden !== true)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));

  useEffect(() => {
    if (paymentMode !== 'workshop' || !selectedWorkshopId) {
      setWorkshopPayments([]);
      return;
    }
    setProjectDataLoading(true);
    setProjectDataError('');
    getDocsFromServer(collection(db, `workshops/${selectedWorkshopId}/payments`)).then(paymentsSnapshot => {
      setWorkshopPayments(paymentsSnapshot.docs.map(item => ({ id: item.id, ...item.data() })));
      setProjectDataLoadedAt(Date.now());
    }).catch(error => setProjectDataError(error?.message || String(error)))
      .finally(() => setProjectDataLoading(false));
  }, [db, paymentMode, selectedWorkshopId]);

  useEffect(() => {
    if (paymentMode !== 'workshop' || !selectedWorkshop) return;
    setAmount(String(selectedWorkshop.price || ''));
  }, [paymentMode, selectedWorkshop]);

  const availableProjectPaymentParts = useMemo(
    () => selectedStudent
      ? getAvailableProjectPaymentParts(projectPayments, selectedStudent.id)
      : [],
    [projectPayments, selectedStudent]
  );

  const loadProjectPaymentData = useCallback(async (projectId) => {
    if (!projectId) return;
    const generation = projectLoadGeneration.current + 1;
    projectLoadGeneration.current = generation;
    setProjectDataLoading(true);
    setProjectDataError('');
    try {
      const [membersSnapshot, paymentsSnapshot] = await Promise.all([
        getDocsFromServer(collection(db, `projects/${projectId}/signedStudents`)),
        getDocsFromServer(collection(db, `projects/${projectId}/payments`)),
      ]);
      if (projectLoadGeneration.current !== generation) return;
      setProjectMembers(membersSnapshot.docs.map(item => ({ id: item.id, ...item.data() })));
      setProjectPayments(paymentsSnapshot.docs.map(item => ({ id: item.id, ...item.data() })));
      setProjectDataLoadedAt(Date.now());
    } catch (error) {
      if (projectLoadGeneration.current !== generation) return;
      setProjectMembers([]);
      setProjectPayments([]);
      setProjectDataError(error?.message || String(error));
    } finally {
      if (projectLoadGeneration.current === generation) setProjectDataLoading(false);
    }
  }, [db]);

  useEffect(() => {
    setSearchTerm('');
    setSelectedStudent(null);
    setProjectPaymentPart('');
    if (paymentMode !== 'workshop') setAmount('');
    setErrors({});
    if (paymentMode !== 'project' || !selectedProjectId) {
      projectLoadGeneration.current += 1;
      setProjectMembers([]);
      setProjectPayments([]);
      setProjectDataError('');
      setProjectDataLoadedAt(null);
      return;
    }
    loadProjectPaymentData(selectedProjectId);
  }, [loadProjectPaymentData, paymentMode, selectedProjectId]);

  useEffect(() => {
    if (paymentMode !== 'project' || !selectedProject) return;
    const nextPart = availableProjectPaymentParts.includes(projectPaymentPart)
      ? projectPaymentPart
      : availableProjectPaymentParts[0] || '';
    if (nextPart !== projectPaymentPart) setProjectPaymentPart(nextPart);
    const nextAmount = getProjectPaymentAmount(selectedProject.price, nextPart);
    setAmount(nextAmount === null ? '' : String(nextAmount));
  }, [availableProjectPaymentParts, paymentMode, projectPaymentPart, selectedProject]);

  const toggleGroup = (id) => {
    clearError('groups');
    setSelectedGroups(prev =>
      prev.includes(id) ? prev.filter(g => g !== id) : [...prev, id]
    );
  };

  // Prefer the stable student ID, while retaining support for older name links.
  useEffect(() => {
    if (!studentsLoaded || appliedPrefillQuery.current === location.search) return;

    const params = new URLSearchParams(location.search);
    const studentIdFromURL = params.get('studentId');
    const nameFromURL = params.get('studentName');
    const projectIdFromURL = params.get('projectId');
    const workshopIdFromURL = params.get('workshopId');
    const paymentModeFromURL = params.get('mode');
    appliedPrefillQuery.current = location.search;

    if (!isCoach && paymentModeFromURL === 'other') {
      setPaymentMode('other');
    } else if (paymentModeFromURL === 'project') {
      setPaymentMode('project');
      if (projectIdFromURL) setSelectedProjectId(projectIdFromURL);
    } else if (paymentModeFromURL === 'workshop') {
      setPaymentMode('workshop');
      if (workshopIdFromURL) setSelectedWorkshopId(workshopIdFromURL);
    }

    if (paymentModeFromURL === 'project' || paymentModeFromURL === 'workshop') return;
    if (!studentIdFromURL && !nameFromURL) return;

    const match = studentIdFromURL
      ? students.find(s => s.id === studentIdFromURL)
      : students.find(s => s.name === nameFromURL);

    if (match) {
      setSearchTerm(match.name);
      setSelectedStudent(match);
    } else if (nameFromURL) {
      setSearchTerm(nameFromURL);
    }
  }, [isCoach, students, studentsLoaded, location.search]);

  useEffect(() => {
    if (paymentMode !== 'workshop' || projectDataLoading || selectedStudent) return;
    const studentId = new URLSearchParams(location.search).get('studentId');
    const match = students.find(student => student.id === studentId);
    if (match && !paidWorkshopStudentIds.has(match.id)) {
      setSelectedStudent(match);
      setSearchTerm(match.name || match.id);
    }
  }, [location.search, paidWorkshopStudentIds, paymentMode, projectDataLoading, selectedStudent, selectedWorkshopId, students]);

  useEffect(() => {
    if (paymentMode !== 'project' || projectDataLoading || projectMembers.length === 0) return;
    const params = new URLSearchParams(location.search);
    const studentIdFromURL = params.get('studentId');
    if (!studentIdFromURL || selectedStudent) return;
    if (!projectMemberIds.has(studentIdFromURL)) return;
    const match = students.find(student => student.id === studentIdFromURL);
    if (!match) return;
    setSelectedStudent(match);
    setSearchTerm(match.name || match.id);
  }, [
    location.search,
    paymentMode,
    projectDataLoading,
    projectMemberIds,
    projectMembers.length,
    selectedStudent,
    students,
  ]);

  const handleRefreshStudents = async () => {
    try {
      await refreshStudents();
    } catch (err) {
      // The context keeps the user-facing error for the status message below.
      console.error('Failed to refresh students for payment form:', err);
    }
  };

  const handleSubmit = async () => {
    if (submissionInProgress.current || !studentsLoaded || studentsLoading) return;

    const nextErrors = {};
    const isOtherPayment = !isCoach && paymentMode === 'other';
    const isProjectPayment = paymentMode === 'project';
    const isWorkshopPayment = paymentMode === 'workshop';
    const isGroupPayment = paymentMode === 'group';
    if (isProjectPayment && !selectedProject) nextErrors.project = 'Select a project.';
    if (isWorkshopPayment && !selectedWorkshop) nextErrors.project = 'Select a workshop.';
    if (isProjectPayment && projectDataLoading) nextErrors.project = 'Wait for project data to load.';
    if (!selectedStudent) nextErrors.student = 'Select a student from the list.';
    if (!amount) nextErrors.amount = 'Amount is required.';
    if (isGroupPayment || isOtherPayment) {
      if (!startDate) nextErrors.startDate = 'Start date is required.';
    }
    if (!paidDate) nextErrors.paidDate = 'Payment date is required.';
    if (isOtherPayment) {
      if (!reason) nextErrors.reason = 'Select a payment reason.';
    } else if (isGroupPayment) {
      if (!type) nextErrors.type = 'Select the number of classes.';
      if (selectedGroups.length === 0) nextErrors.groups = 'Select at least one group.';
    } else if (isProjectPayment && !projectPaymentPart) {
      nextErrors.projectPaymentPart = availableProjectPaymentParts.length === 0
        ? 'This student has already paid the full project price.'
        : 'Select full payment or a 50% installment.';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const amountNum = parseFloat(String(amount).replace(',', '.'));
    const typeNum = isGroupPayment ? parseInt(String(type), 10) : null;
    const discountNum = isGroupPayment
      ? parseFloat(String(discount || '0').replace(',', '.'))
      : 0;

    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      nextErrors.amount = 'Enter a valid amount greater than zero.';
    }
    if (isGroupPayment && (Number.isNaN(typeNum) || typeNum <= 0)) {
      nextErrors.type = 'Select a valid type.';
    }
    if (isGroupPayment && Number.isNaN(discountNum)) {
      nextErrors.discount = 'Enter a valid discount.';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    submissionInProgress.current = true;
    setIsSubmitting(true);
    try {
      const timestamp = Timestamp.now();
      if (isWorkshopPayment) {
        const studentId = selectedStudent.id;
        const workshopRef = doc(db, 'workshops', selectedWorkshop.id);
        const memberRef = doc(db, `workshops/${selectedWorkshop.id}/signedStudents`, studentId);
        const paymentRef = doc(db, `workshops/${selectedWorkshop.id}/payments`, studentId);
        const paymentData = {
          studentId, studentName: selectedStudent.name || studentId, amount: amountNum,
          dateFrom: formatEuropeanDate(selectedWorkshop.date), createdAt: formatEuropeanDate(paidDate),
          timestamp, status: 'active', paymentKind: 'workshop', workshopId: selectedWorkshop.id,
          workshopName: selectedWorkshop.name, paymentMethod: isCoach ? 'cash' : paymentMethod,
          recordedBy: user?.id || '', recordedByRole: user?.role || '',
        };
        await runTransaction(db, async transaction => {
          const [workshopSnapshot, memberSnapshot, paymentSnapshot] = await Promise.all([
            transaction.get(workshopRef), transaction.get(memberRef), transaction.get(paymentRef),
          ]);
          if (!workshopSnapshot.exists()) throw new Error('This workshop no longer exists.');
          if (paymentSnapshot.exists()) throw new Error('This workshop payment already exists.');
          if (!memberSnapshot.exists()) {
            transaction.set(memberRef, {
              studentId, studentName: selectedStudent.name || studentId,
              signedAt: timestamp, signedBy: user?.id || '',
            });
            transaction.update(workshopRef, {
              signedStudentCount: Number(workshopSnapshot.data()?.signedStudentCount || 0) + 1,
            });
          }
          transaction.set(paymentRef, paymentData);
        });
        invalidateSalarySummaries();
        invalidateWorkshopPaymentHistory();
        navigate(`/workshop/${selectedWorkshop.id}`);
        return;
      }
      if (isProjectPayment) {
        const studentId = selectedStudent.id;
        const paymentData = {
          studentId,
          studentName: selectedStudent.name || studentId,
          amount: amountNum,
          dateFrom: formatEuropeanDate(selectedProject.startDate),
          createdAt: formatEuropeanDate(paidDate),
          timestamp,
          status: 'active',
          paymentKind: 'project',
          paymentPart: projectPaymentPart,
          paymentPlan: projectPaymentPart === 'full' ? 'full' : 'split',
          installmentNumber: projectPaymentPart === 'second_half' ? 2 : 1,
          installmentCount: projectPaymentPart === 'full' ? 1 : 2,
          paymentMethod: isCoach ? 'cash' : paymentMethod,
          recordedBy: user?.id || '',
          recordedByRole: user?.role || '',
        };
        const projectRef = doc(db, 'projects', selectedProject.id);
        const memberRef = doc(db, `projects/${selectedProject.id}/signedStudents`, studentId);
        const paymentRefs = ['full', 'first_half', 'second_half'].map(part => ({
          part,
          ref: doc(
            db,
            `projects/${selectedProject.id}/payments`,
            getProjectPaymentDocId(studentId, part)
          ),
        }));
        const legacyPaymentRef = doc(db, `projects/${selectedProject.id}/payments`, studentId);

        await runTransaction(db, async transaction => {
          const [projectSnapshot, memberSnapshot, legacySnapshot, ...paymentSnapshots] =
            await Promise.all([
              transaction.get(projectRef),
              transaction.get(memberRef),
              transaction.get(legacyPaymentRef),
              ...paymentRefs.map(item => transaction.get(item.ref)),
            ]);
          if (!projectSnapshot.exists()) throw new Error('This project no longer exists.');
          if (!memberSnapshot.exists()) throw new Error('This student is not signed for the project.');
          const existingPayments = [
            ...(legacySnapshot.exists()
              ? [{ id: legacySnapshot.id, ...legacySnapshot.data(), studentId }]
              : []),
            ...paymentSnapshots.flatMap((snapshot, index) => snapshot.exists()
              ? [{
                  id: snapshot.id,
                  ...snapshot.data(),
                  studentId,
                  paymentPart: snapshot.data()?.paymentPart || paymentRefs[index].part,
                }]
              : []),
          ];
          const availableParts = getAvailableProjectPaymentParts(existingPayments, studentId);
          if (!availableParts.includes(projectPaymentPart)) {
            throw new Error('This project payment was already completed or changed. Refresh and try again.');
          }
          const targetRef = paymentRefs.find(item => item.part === projectPaymentPart)?.ref;
          transaction.set(targetRef, paymentData);
        });

        invalidateSalarySummaries();
        invalidateProjectPaymentHistory();
        navigate(`/project/${selectedProject.id}`);
        return;
      }

      const batch = writeBatch(db);
      const commonPaymentData = {
        studentId: selectedStudent.id,
        amount: amountNum,
        dateFrom: formatEuropeanDate(startDate),
        createdAt: formatEuropeanDate(paidDate),
        timestamp,
        status: 'active',
        paymentMethod: isCoach ? 'cash' : paymentMethod,
      };

      let paymentData;
      let savedPaymentId;
      if (isOtherPayment) {
        savedPaymentId = doc(collection(db, 'otherpayments')).id;
        const month = getOtherPaymentMonth(commonPaymentData.dateFrom);
        paymentData = {
          ...commonPaymentData,
          reason,
          paymentKind: 'other',
        };
        batch.set(doc(db, 'otherpayments', month), {
          month,
          updatedAt: timestamp,
          payments: {
            [savedPaymentId]: paymentData,
          },
        }, { merge: true });
      } else {
        const paymentRef = doc(collection(db, 'payments'));
        savedPaymentId = paymentRef.id;
        paymentData = {
          ...commonPaymentData,
          type: typeNum,
          discount: discountNum,
          groups: selectedGroups,
          ...(startTime ? { timeFrom: startTime } : {}),
        };
        batch.set(paymentRef, paymentData);
        batch.update(doc(db, 'students', selectedStudent.id), {
          groups: arrayUnion(...selectedGroups),
          lastPaymentId: savedPaymentId,
        });
      }

      await batch.commit(); // all-or-nothing

      if (isGroupPayment) {
        upsertPayment({ id: savedPaymentId, ...paymentData });
        patchStudent(selectedStudent.id, currentStudent => ({
          groups: [...new Set([...(currentStudent.groups || []), ...selectedGroups])],
          lastPaymentId: savedPaymentId,
        }));
      }
      if (isOtherPayment) invalidateOtherPaymentHistory();
      invalidateSalarySummaries();

      // Reset form
      setSearchTerm('');
      setSelectedStudent(null);
      setAmount('');
      setType('');
      setDiscount('0');
      setStartDate('');
      setStartTime('');
      setPaidDate('');
      setSelectedGroups([]);
      setReason('');
      setErrors({});

      const requestedReturnPath = new URLSearchParams(location.search).get('returnTo');
      const safeReturnPath = requestedReturnPath?.startsWith('/student/')
        ? requestedReturnPath
        : '';
      navigate(
        isOtherPayment
          ? safeReturnPath || '/payment-history'
          : `/student/${paymentData.studentId}`
      );
    } catch (err) {
      console.error(err);
      alert('❌ Error saving payment. Nothing was saved.');
    } finally {
      submissionInProgress.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className="add-payment-page">
      <h2 className="title">ADD A PAYMENT</h2>

      <div className="payment-mode-toggle" role="group" aria-label="Payment type">
          <button
            type="button"
            className={`payment-mode-button${paymentMode === 'group' ? ' active' : ''}`}
            aria-pressed={paymentMode === 'group'}
            onClick={() => {
              setPaymentMode('group');
              setErrors({});
            }}
            disabled={isSubmitting}
          >
            Groups
          </button>
          <button
            type="button"
            className={`payment-mode-button${paymentMode === 'project' ? ' active' : ''}`}
            aria-pressed={paymentMode === 'project'}
            onClick={() => {
              setPaymentMode('project');
              setErrors({});
            }}
            disabled={isSubmitting}
          >
            Projects
          </button>
          <button
            type="button"
            className={`payment-mode-button${paymentMode === 'workshop' ? ' active' : ''}`}
            aria-pressed={paymentMode === 'workshop'}
            onClick={() => { setPaymentMode('workshop'); setErrors({}); }}
            disabled={isSubmitting}
          >
            Workshops
          </button>
          {!isCoach && (
          <button
            type="button"
            className={`payment-mode-button${paymentMode === 'other' ? ' active' : ''}`}
            aria-pressed={paymentMode === 'other'}
            onClick={() => {
              setPaymentMode('other');
              setErrors({});
            }}
            disabled={isSubmitting}
          >
            Other
          </button>
          )}
        </div>

      {paymentMode === 'project' && (
        <>
          <div className={`form-row ${selectedProject ? 'required-filled' : 'required-empty'}`}>
            <label>PROJECT:</label>
            <select
              className="input"
              value={selectedProjectId}
              onChange={event => {
                setSelectedProjectId(event.target.value);
                clearError('project');
              }}
              aria-invalid={Boolean(errors.project)}
              disabled={isSubmitting}
            >
              <option value="">Select project</option>
              {sortedProjects.map(project => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </div>
          {selectedProjectId && (
            <RefreshStatus
              message={projectDataLoadedAt
                ? `Project updated: ${new Date(projectDataLoadedAt).toLocaleString()}`
                : 'Project roster and payments are not loaded yet'}
              error={projectDataError}
              loading={projectDataLoading}
              onRefresh={() => loadProjectPaymentData(selectedProjectId)}
              refreshLabel="Refresh project"
            />
          )}
        </>
      )}
      {paymentMode === 'workshop' && (
        <div className={`form-row ${selectedWorkshop ? 'required-filled' : 'required-empty'}`}>
          <label>WORKSHOP:</label>
          <select className="input" value={selectedWorkshopId} onChange={event => { setSelectedWorkshopId(event.target.value); setSelectedStudent(null); setSearchTerm(''); clearError('project'); }}>
            <option value="">Select workshop</option>
            {sortedWorkshops.map(workshop => <option key={workshop.id} value={workshop.id}>{workshop.name} · {workshop.date}</option>)}
          </select>
        </div>
      )}

      <RefreshStatus
        message={studentsLoaded
          ? students.length === 0
            ? 'No students are available'
            : studentsLastLoadedAt
              ? `Last updated: ${new Date(studentsLastLoadedAt).toLocaleString()}`
              : 'Not updated yet'
          : 'Not updated yet'}
        error={studentsError ? `Could not load students: ${studentsError}` : ''}
        loading={studentsLoading}
        onRefresh={handleRefreshStudents}
        refreshLabel={studentsError ? 'Retry students' : 'Refresh students'}
        loadingLabel={studentsError ? 'Retrying…' : 'Refreshing…'}
      />

      <div className={`form-row ${selectedStudent ? 'required-filled' : 'required-empty'}`}>
        <label>WHO:</label>
        <input
          placeholder="Search student"
          value={searchTerm}
          onChange={e => {
            setSearchTerm(e.target.value);
            setSelectedStudent(null);
          }}
          className="input"
          aria-invalid={Boolean(errors.student)}
          disabled={
            !studentsLoaded ||
            studentsLoading ||
            isSubmitting ||
            ((paymentMode === 'project' && !selectedProject) || (paymentMode === 'workshop' && !selectedWorkshop) || ((paymentMode === 'project' || paymentMode === 'workshop') && projectDataLoading))
          }
        />
        {searchTerm && !selectedStudent && (
          <ul className="dropdown">
            {filteredStudents.map(s => (
              <li
                key={s.id}
                onClick={() => {
                  setSelectedStudent(s);
                  setSearchTerm(s.name);
                  clearError('student');
                }}
              >
                {s.name}
              </li>
            ))}
          </ul>
        )}
      </div>

      {paymentMode === 'project' && selectedStudent && (
        <div className={`form-row ${projectPaymentPart ? 'required-filled' : 'required-empty'}`}>
          <label>PROJECT PAYMENT:</label>
          {availableProjectPaymentParts.length === 0 ? (
            <p className="project-payment-complete" role="status">
              This student has already paid the full project price.
            </p>
          ) : (
            <select
              className="input"
              value={projectPaymentPart}
              onChange={event => {
                setProjectPaymentPart(event.target.value);
                clearError('projectPaymentPart');
              }}
              aria-invalid={Boolean(errors.projectPaymentPart)}
            >
              {availableProjectPaymentParts.map(part => (
                <option key={part} value={part}>{PROJECT_PAYMENT_PART_LABELS[part]}</option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className={`form-row ${amount ? 'required-filled' : 'required-empty'}${errors.amount && amount ? ' has-error' : ''}`}>
        <label>AMOUNT (€):</label>
        <input
          className="input"
          value={amount}
          onChange={e => {
            setAmount(e.target.value);
            clearError('amount');
          }}
          inputMode="decimal"
          readOnly={paymentMode === 'project'}
          aria-invalid={Boolean(errors.amount)}
        />
        {paymentMode === 'workshop' && selectedWorkshop && (
          <small className="workshop-price-hint">
            Standard price: €{Number(selectedWorkshop.price || 0).toFixed(2)}. You can enter an early-bird price.
          </small>
        )}
      </div>

      <div className="payment-method-row">
        <span className="payment-method-label">PAID BY:</span>
        <div className="payment-mode-toggle payment-method-toggle" role="group" aria-label="Payment method">
          {PAYMENT_METHODS.map(method => {
            const disabled = isSubmitting || (isCoach && method.value !== 'cash');
            return (
              <button
                key={method.value}
                type="button"
                className={`payment-mode-button${paymentMethod === method.value ? ' active' : ''}`}
                aria-pressed={paymentMethod === method.value}
                onClick={() => setPaymentMethod(method.value)}
                disabled={disabled}
              >
                {method.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className={`form-row ${paidDate ? 'required-filled' : 'required-empty'}`}>
        <label>PAYMENT DATE:</label>
        <input
          type="date"
          className="input"
          value={paidDate}
          onChange={e => {
            setPaidDate(e.target.value);
            clearError('paidDate');
          }}
          aria-invalid={Boolean(errors.paidDate)}
        />
      </div>

      {paymentMode !== 'project' && paymentMode !== 'workshop' && (
      <div className={`form-row ${startDate ? 'required-filled' : 'required-empty'}`}>
        <label>DATE FROM:</label>
        <input
          type="date"
          className="input"
          value={startDate}
          onChange={e => {
            setStartDate(e.target.value);
            clearError('startDate');
          }}
          aria-invalid={Boolean(errors.startDate)}
        />
      </div>
      )}

      {paymentMode === 'other' ? (
        <div className={`form-row ${reason ? 'required-filled' : 'required-empty'}`}>
          <label>REASON:</label>
          <select
            className="input"
            value={reason}
            onChange={e => {
              setReason(e.target.value);
              clearError('reason');
            }}
            aria-invalid={Boolean(errors.reason)}
          >
            <option value="">Select...</option>
            {OTHER_PAYMENT_REASONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      ) : paymentMode === 'group' ? (
        <>
          <div className="form-row optional-field">
            <label>Time from <span>optional</span></label>
            <input
              type="time"
              className="input optional-input"
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
            />
          </div>

          <div className={`form-row ${type ? 'required-filled' : 'required-empty'}`}>
            <label>TYPE:</label>
            <select
              className="input"
              value={type}
              onChange={e => {
                setType(e.target.value);
                clearError('type');
              }}
              aria-invalid={Boolean(errors.type)}
            >
              <option value="">Select...</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 12, 24].map((num) => (
                <option key={num} value={num}>
                  {num} CLASSES
                </option>
              ))}
            </select>
          </div>

          <div className={`form-row ${selectedGroups.length > 0 ? 'required-filled' : 'required-empty'}`}>
            <label>GROUPS:</label>
            <div className="group-box" aria-invalid={Boolean(errors.groups)}>
              {[
                ['OPEN CLASSES', openPaymentGroups],
                ['CLOSED GROUPS', closedPaymentGroups],
              ].map(([heading, items]) => items.length > 0 && (
                <section className="payment-group-section" key={heading}>
                  <h3>{heading}</h3>
                  <div className="payment-group-options">
                    {items.map(group => (
                      <label key={group.id} className="group-checkbox">
                        <input
                          type="checkbox"
                          checked={selectedGroups.includes(group.id)}
                          onChange={() => toggleGroup(group.id)}
                        />
                        {group.name}
                      </label>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>

          <div className={`form-row optional-field${errors.discount ? ' has-error' : ''}`}>
            <label>Discount (%) <span>optional</span></label>
            <input
              className="input optional-input"
              value={discount}
              onChange={e => {
                setDiscount(e.target.value);
                clearError('discount');
              }}
              placeholder="0"
              inputMode="decimal"
              aria-invalid={Boolean(errors.discount)}
            />
          </div>
        </>
      ) : null}

      <GradientActionButton
        wide
        icon={isSubmitting || studentsLoading ? '…' : '+'}
        onClick={handleSubmit}
        disabled={
          isSubmitting ||
          !studentsLoaded ||
          studentsLoading ||
          (paymentMode === 'project' && (
            !selectedProject ||
            projectDataLoading ||
            availableProjectPaymentParts.length === 0
          ))
        }
        title={
          isSubmitting
            ? 'Saving…'
            : !studentsLoaded || studentsLoading
              ? 'Wait for students to load'
              : 'Save payment'
        }
      >
        {isSubmitting ? 'SAVING…' : studentsLoading ? 'LOADING…' : 'ADD PAYMENT'}
      </GradientActionButton>
    </div>
  );
}

export default AddPaymentPage;
