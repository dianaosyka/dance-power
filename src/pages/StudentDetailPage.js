import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import {
  deleteDoc,
  deleteField,
  doc,
  FieldPath,
  runTransaction,
  updateDoc,
} from 'firebase/firestore';
import { STAFF_DATA_CACHE_TTL_MS, useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import './StudentDetailPage.css';
import { getPaymentClasses, isClassUpcoming } from '../utils/paymentsUtils';
import { invalidateSalarySummaries } from '../utils/salaryCache';
import { getPaymentMethodLabel } from '../utils/paymentMethodUtils';
import { getOtherPaymentReasonLabel } from '../utils/otherPaymentsUtils';
import {
  getOtherPaymentHistoryCache,
  hasFreshOtherPaymentHistory,
  invalidateOtherPaymentHistory,
  loadOtherPaymentHistory,
} from '../utils/otherPaymentsCache';
import RefreshStatus from '../components/RefreshStatus';
import {
  getWorkshopPaymentHistoryCache,
  hasFreshWorkshopPaymentHistory,
  invalidateWorkshopPaymentHistory,
  loadWorkshopPaymentHistory,
} from '../utils/workshopPaymentsCache';
import {
  getProjectPaymentHistoryCache,
  hasFreshProjectPaymentHistory,
  invalidateProjectPaymentHistory,
  loadProjectPaymentHistory,
} from '../utils/projectPaymentsCache';
import { PROJECT_PAYMENT_PART_LABELS } from '../utils/projectPaymentUtils';

function getPaymentSortValue(payment) {
  if (typeof payment?.timestamp?.toMillis === 'function') {
    return payment.timestamp.toMillis();
  }
  return Number(payment?.timestamp?.seconds || 0) * 1000;
}

function sortPaymentsNewestFirst(items) {
  return [...items].sort((first, second) => {
    const timeDifference = getPaymentSortValue(second) - getPaymentSortValue(first);
    return timeDifference || String(second.id).localeCompare(String(first.id));
  });
}

function StudentDetailPage() {
  const { studentId } = useParams();
  const {
    db,
    students,
    payments,
    groups,
    workshops = [],
    projects = [],
    pastClassesByGroup,
    loadPastClassDocs,
    studentsLoaded,
    paymentsLoaded,
    studentsLoading,
    paymentsLoading,
    studentsError,
    paymentsError,
    studentsLastLoadedAt,
    paymentsLastLoadedAt,
    loadStudentById,
    loadPaymentsForStudent,
    refreshStudents,
    refreshPayments,
    patchStudent,
    removeStudent,
    removePayment,
  } = useData();
  const { user, setUser } = useUser();
  const navigate = useNavigate();
  const location = useLocation();
  const paymentIdFromHistory = new URLSearchParams(location.search).get('paymentId') || '';
  const otherPaymentIdFromHistory = new URLSearchParams(location.search).get('otherPaymentId') || '';
  const workshopPaymentIdFromHistory = new URLSearchParams(location.search).get('workshopPaymentId') || '';
  const workshopIdFromHistory = new URLSearchParams(location.search).get('workshopId') || '';
  const projectPaymentIdFromHistory = new URLSearchParams(location.search).get('projectPaymentId') || '';
  const projectIdFromHistory = new URLSearchParams(location.search).get('projectId') || '';
  const isStaff = user?.role === 'admin' || user?.role === 'coach';
  const isAdmin = user?.role === 'admin';
  const otherPaymentScope = user?.id || user?.role || 'signed-out';

  const [currentIndex, setCurrentIndex] = useState(0);
  const [paymentDetailView, setPaymentDetailView] = useState(
    () => otherPaymentIdFromHistory ? 'other' : workshopPaymentIdFromHistory ? 'workshop' : projectPaymentIdFromHistory ? 'project' : 'group'
  );
  const [absences, setAbsences] = useState({});
  const [classes, setClasses] = useState([]);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [classesError, setClassesError] = useState('');
  const [classesLoadAttempt, setClassesLoadAttempt] = useState(0);
  const [classesPaymentKey, setClassesPaymentKey] = useState('');
  const [scopedStudent, setScopedStudent] = useState(null);
  const [scopedPayments, setScopedPayments] = useState([]);
  const [scopedStudentKey, setScopedStudentKey] = useState('');
  const [scopedPaymentsKey, setScopedPaymentsKey] = useState('');
  const [scopedStudentLoading, setScopedStudentLoading] = useState(false);
  const [scopedPaymentsLoading, setScopedPaymentsLoading] = useState(false);
  const [scopedStudentError, setScopedStudentError] = useState('');
  const [scopedPaymentsError, setScopedPaymentsError] = useState('');
  const [scopedStudentLoadedAt, setScopedStudentLoadedAt] = useState(null);
  const [scopedPaymentsLoadedAt, setScopedPaymentsLoadedAt] = useState(null);
  const [refreshingDetail, setRefreshingDetail] = useState(false);
  const [deletingPayment, setDeletingPayment] = useState(false);
  const [deletingStudent, setDeletingStudent] = useState(false);
  const [otherPayments, setOtherPayments] = useState(
    () => getOtherPaymentHistoryCache(otherPaymentScope).payments
  );
  const [otherPaymentsLoading, setOtherPaymentsLoading] = useState(false);
  const [otherPaymentsError, setOtherPaymentsError] = useState('');
  const [deletingOtherPaymentId, setDeletingOtherPaymentId] = useState('');
  const [workshopPayments, setWorkshopPayments] = useState(
    () => getWorkshopPaymentHistoryCache().payments
  );
  const [workshopPaymentsLoading, setWorkshopPaymentsLoading] = useState(false);
  const [workshopPaymentsError, setWorkshopPaymentsError] = useState('');
  const [deletingWorkshopPaymentId, setDeletingWorkshopPaymentId] = useState('');
  const [projectPayments, setProjectPayments] = useState(
    () => getProjectPaymentHistoryCache(otherPaymentScope).payments
  );
  const [projectPaymentsLoading, setProjectPaymentsLoading] = useState(false);
  const [projectPaymentsError, setProjectPaymentsError] = useState('');
  const [deletingProjectPaymentId, setDeletingProjectPaymentId] = useState('');
  const studentLoadGeneration = useRef(0);
  const paymentsLoadGeneration = useRef(0);
  const detailRefreshInProgress = useRef(false);
  const paymentDeletionInProgress = useRef(false);
  const studentDeletionInProgress = useRef(false);
  const selectedOtherPaymentElement = useRef(null);
  const appliedPaymentLink = useRef('');
  const appliedOtherPaymentLink = useRef('');
  const selectedWorkshopPaymentElement = useRef(null);
  const appliedWorkshopPaymentLink = useRef('');
  const selectedProjectPaymentElement = useRef(null);
  const appliedProjectPaymentLink = useRef('');

  const loadProjectPayments = useCallback(async ({ force = false } = {}) => {
    if (!isStaff) return [];
    if (!force && hasFreshProjectPaymentHistory(otherPaymentScope, projects, STAFF_DATA_CACHE_TTL_MS)) {
      const cached = getProjectPaymentHistoryCache(otherPaymentScope);
      setProjectPayments(cached.payments);
      return cached.payments;
    }
    setProjectPaymentsLoading(true);
    setProjectPaymentsError('');
    try {
      const result = await loadProjectPaymentHistory(db, projects, otherPaymentScope);
      setProjectPayments(result.payments);
      return result.payments;
    } catch (error) {
      setProjectPaymentsError(error?.message || String(error));
      throw error;
    } finally {
      setProjectPaymentsLoading(false);
    }
  }, [db, isStaff, otherPaymentScope, projects]);

  useEffect(() => {
    if (!isStaff) return undefined;
    loadProjectPayments().catch(() => {});
    return undefined;
  }, [isStaff, loadProjectPayments]);

  const loadWorkshopPayments = useCallback(async ({ force = false } = {}) => {
    if (!isStaff) return [];
    if (!force && hasFreshWorkshopPaymentHistory(workshops, STAFF_DATA_CACHE_TTL_MS)) {
      const cached = getWorkshopPaymentHistoryCache();
      setWorkshopPayments(cached.payments);
      return cached.payments;
    }
    setWorkshopPaymentsLoading(true);
    setWorkshopPaymentsError('');
    try {
      const result = await loadWorkshopPaymentHistory(db, workshops);
      setWorkshopPayments(result.payments);
      return result.payments;
    } catch (error) {
      setWorkshopPaymentsError(error?.message || String(error));
      throw error;
    } finally {
      setWorkshopPaymentsLoading(false);
    }
  }, [db, isStaff, workshops]);

  useEffect(() => {
    if (!isStaff) return undefined;
    loadWorkshopPayments().catch(() => {});
    return undefined;
  }, [isStaff, loadWorkshopPayments]);

  const loadOtherPayments = useCallback(async ({ force = false } = {}) => {
    if (!isAdmin) return [];
    if (!force && hasFreshOtherPaymentHistory(otherPaymentScope, STAFF_DATA_CACHE_TTL_MS)) {
      const cachedHistory = getOtherPaymentHistoryCache(otherPaymentScope);
      setOtherPayments(cachedHistory.payments);
      return cachedHistory.payments;
    }

    setOtherPaymentsLoading(true);
    setOtherPaymentsError('');
    try {
      const result = await loadOtherPaymentHistory(db, otherPaymentScope);
      setOtherPayments(result.payments);
      return result.payments;
    } catch (error) {
      setOtherPaymentsError(error?.message || String(error));
      throw error;
    } finally {
      setOtherPaymentsLoading(false);
    }
  }, [db, isAdmin, otherPaymentScope]);

  useEffect(() => {
    if (!isAdmin) return undefined;
    loadOtherPayments().catch(() => {});
    return undefined;
  }, [isAdmin, loadOtherPayments]);

  const loadScopedStudent = useCallback(async ({ force = false } = {}) => {
    if (!isStaff) return null;
    const generation = studentLoadGeneration.current + 1;
    studentLoadGeneration.current = generation;
    setScopedStudentLoading(true);
    setScopedStudentError('');
    try {
      const nextStudent = await loadStudentById(studentId, { force });
      if (studentLoadGeneration.current !== generation) return nextStudent;
      setScopedStudent(nextStudent);
      setScopedStudentKey(studentId);
      setScopedStudentLoadedAt(Date.now());
      return nextStudent;
    } catch (error) {
      if (studentLoadGeneration.current === generation) {
        setScopedStudentError(error?.message || String(error));
      }
      throw error;
    } finally {
      if (studentLoadGeneration.current === generation) {
        setScopedStudentLoading(false);
      }
    }
  }, [isStaff, loadStudentById, studentId]);

  const loadScopedPayments = useCallback(async ({ force = false } = {}) => {
    if (!isStaff) return [];
    const generation = paymentsLoadGeneration.current + 1;
    paymentsLoadGeneration.current = generation;
    setScopedPaymentsLoading(true);
    setScopedPaymentsError('');
    try {
      const nextPayments = await loadPaymentsForStudent(studentId, { force });
      if (paymentsLoadGeneration.current !== generation) return nextPayments;
      setScopedPayments(nextPayments);
      setScopedPaymentsKey(studentId);
      setScopedPaymentsLoadedAt(Date.now());
      return nextPayments;
    } catch (error) {
      if (paymentsLoadGeneration.current === generation) {
        setScopedPaymentsError(error?.message || String(error));
      }
      throw error;
    } finally {
      if (paymentsLoadGeneration.current === generation) {
        setScopedPaymentsLoading(false);
      }
    }
  }, [isStaff, loadPaymentsForStudent, studentId]);

  useEffect(() => {
    if (!isStaff) return undefined;

    const ensureScopedData = () => {
      loadScopedStudent().catch(() => {});
      loadScopedPayments().catch(() => {});
    };
    ensureScopedData();
    window.addEventListener('focus', ensureScopedData);
    return () => {
      window.removeEventListener('focus', ensureScopedData);
      studentLoadGeneration.current += 1;
      paymentsLoadGeneration.current += 1;
    };
  }, [isStaff, loadScopedPayments, loadScopedStudent]);

  const listenerStudent = students.find(s => s.id === studentId) || null;
  const student = isStaff
    ? scopedStudentKey === studentId ? scopedStudent : null
    : listenerStudent;
  const studentDataLoaded = isStaff ? scopedStudentKey === studentId : studentsLoaded;
  const paymentDataLoaded = isStaff ? scopedPaymentsKey === studentId : paymentsLoaded;
  const studentDataLoading = isStaff ? scopedStudentLoading : studentsLoading;
  const paymentDataLoading = isStaff ? scopedPaymentsLoading : paymentsLoading;
  const studentDataError = isStaff ? scopedStudentError : studentsError;
  const paymentDataError = isStaff ? scopedPaymentsError : paymentsError;
  const studentDataLoadedAt = isStaff ? scopedStudentLoadedAt : studentsLastLoadedAt;
  const paymentDataLoadedAt = isStaff ? scopedPaymentsLoadedAt : paymentsLastLoadedAt;
  const paymentSource = isStaff
    ? scopedPaymentsKey === studentId ? scopedPayments : []
    : payments;

  const studentEmail = student?.email?.trim();
  const studentInstagram = student?.instagram?.trim();
  const instagramHandle = studentInstagram
    ?.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@/, '')
    .replace(/\/$/, '');
  const instagramHref = instagramHandle
    ? `https://www.instagram.com/${instagramHandle}`
    : '';

  const StudentContacts = () => {
    if (!studentEmail && !studentInstagram) return null;

    return (
      <div className="student-contact-details">
        {studentEmail && (
          <p>
            EMAIL: <a href={`mailto:${studentEmail}`}>{studentEmail}</a>
          </p>
        )}
        {studentInstagram && (
          <p>
            INSTAGRAM:{' '}
            <a href={instagramHref} target="_blank" rel="noreferrer">
              @{instagramHandle}
            </a>
          </p>
        )}
      </div>
    );
  };

  const studentPayments = sortPaymentsNewestFirst(
    paymentSource.filter(payment => payment.studentId === studentId)
  );

  const boundedCurrentIndex = studentPayments.length > 0
    ? Math.min(currentIndex, studentPayments.length - 1)
    : 0;
  const currentPayment =
    studentPayments.length > 0 ? studentPayments[boundedCurrentIndex] : null;
  const studentOtherPayments = sortPaymentsNewestFirst(
    otherPayments.filter(payment => payment.studentId === studentId)
  );
  const studentWorkshopPayments = sortPaymentsNewestFirst(
    workshopPayments.filter(payment => payment.studentId === studentId)
  );
  const studentProjectPayments = sortPaymentsNewestFirst(
    projectPayments.filter(payment => payment.studentId === studentId)
  );
  const workshopsById = new Map(workshops.map(workshop => [workshop.id, workshop]));
  const projectsById = new Map(projects.map(project => [project.id, project]));

  useEffect(() => {
    if (!paymentIdFromHistory) return;
    const linkKey = `${studentId}:${paymentIdFromHistory}`;
    if (appliedPaymentLink.current === linkKey) return;

    const paymentIndex = studentPayments.findIndex(payment => payment.id === paymentIdFromHistory);
    if (paymentIndex >= 0) {
      setCurrentIndex(paymentIndex);
      appliedPaymentLink.current = linkKey;
    }
  }, [paymentIdFromHistory, studentId, studentPayments]);

  useEffect(() => {
    if (!otherPaymentIdFromHistory || otherPaymentsLoading) return;
    const linkKey = `${studentId}:${otherPaymentIdFromHistory}`;
    if (appliedOtherPaymentLink.current === linkKey || !selectedOtherPaymentElement.current) return;

    selectedOtherPaymentElement.current.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    appliedOtherPaymentLink.current = linkKey;
  }, [otherPaymentIdFromHistory, otherPaymentsLoading, studentId, studentOtherPayments]);

  useEffect(() => {
    if (otherPaymentIdFromHistory) setPaymentDetailView('other');
    else if (workshopPaymentIdFromHistory) setPaymentDetailView('workshop');
    else if (projectPaymentIdFromHistory) setPaymentDetailView('project');
    else if (paymentIdFromHistory) setPaymentDetailView('group');
  }, [otherPaymentIdFromHistory, paymentIdFromHistory, projectPaymentIdFromHistory, workshopPaymentIdFromHistory]);

  useEffect(() => {
    if (!projectPaymentIdFromHistory || projectPaymentsLoading) return;
    const linkKey = `${studentId}:${projectIdFromHistory}:${projectPaymentIdFromHistory}`;
    if (appliedProjectPaymentLink.current === linkKey || !selectedProjectPaymentElement.current) return;
    selectedProjectPaymentElement.current.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    appliedProjectPaymentLink.current = linkKey;
  }, [projectIdFromHistory, projectPaymentIdFromHistory, projectPaymentsLoading, studentId, studentProjectPayments]);

  useEffect(() => {
    if (!workshopPaymentIdFromHistory || workshopPaymentsLoading) return;
    const linkKey = `${studentId}:${workshopIdFromHistory}:${workshopPaymentIdFromHistory}`;
    if (appliedWorkshopPaymentLink.current === linkKey || !selectedWorkshopPaymentElement.current) return;
    selectedWorkshopPaymentElement.current.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    appliedWorkshopPaymentLink.current = linkKey;
  }, [studentId, studentWorkshopPayments, workshopIdFromHistory, workshopPaymentIdFromHistory, workshopPaymentsLoading]);

  useEffect(() => {
    if (currentIndex !== boundedCurrentIndex) {
      setCurrentIndex(boundedCurrentIndex);
    }
  }, [boundedCurrentIndex, currentIndex]);

  useEffect(() => {
    setAbsences(student?.absences || {});
  }, [student]);

  useEffect(() => {
    if (!currentPayment) {
      setClasses([]);
      setClassesError('');
      setClassesPaymentKey('');
      setLoadingClasses(false);
      return;
    }

    let active = true;

    const fetchClasses = async () => {
      setLoadingClasses(true);
      setClassesError('');
      setClassesPaymentKey('');
      try {
        const res = await getPaymentClasses({
          payment: currentPayment,
          groups,
          pastClassesByGroup,
          loadPastClassDocs,
        });

        if (active) {
          setClasses(Array.isArray(res) ? res : []);
          setClassesPaymentKey(currentPayment.id);
        }
      } catch (err) {
        console.error('Error fetching payment classes:', err);
        if (active) {
          setClasses([]);
          setClassesError('Classes for this payment could not be loaded.');
          setClassesPaymentKey(currentPayment.id);
        }
      } finally {
        if (active) setLoadingClasses(false);
      }
    };

    fetchClasses();

    return () => {
      active = false;
    };
  }, [classesLoadAttempt, currentPayment, groups, pastClassesByGroup, loadPastClassDocs]);

  const getAttendanceIcon = (groupId, date, groupTime) => {
    if (isClassUpcoming(date, groupTime)) return '🕒';

    const absentGroups = absences?.[date] || [];
    return absentGroups.includes(groupId) ? '❌' : '✅';
  };

  const handleDelete = async () => {
    if (
      deletingPayment
      || deletingStudent
      || paymentDeletionInProgress.current
      || studentDeletionInProgress.current
      || !currentPayment
    ) return;
    const paymentId = currentPayment.id;
    if (!window.confirm('Are you sure you want to delete this payment?')) return;

    paymentDeletionInProgress.current = true;
    setDeletingPayment(true);
    try {
      // The candidate order must come from a forced server query. The
      // transaction then verifies every candidate it may point at, so adjacent
      // concurrent deletions cannot leave lastPaymentId referencing a deleted
      // payment.
      const freshPayments = sortPaymentsNewestFirst(
        await loadPaymentsForStudent(studentId, { force: true })
      );
      const candidates = freshPayments.filter(payment => payment.id !== paymentId);
      const paymentRef = doc(db, 'payments', paymentId);
      const studentRef = doc(db, 'students', studentId);

      const transactionResult = await runTransaction(db, async transaction => {
        const paymentSnapshot = await transaction.get(paymentRef);
        const studentSnapshot = await transaction.get(studentRef);
        if (!studentSnapshot.exists()) {
          throw new Error('Student document does not exist.');
        }

        const serverLastPaymentId = studentSnapshot.data()?.lastPaymentId || '';
        let nextLastPaymentId = serverLastPaymentId;
        const shouldMovePointer = serverLastPaymentId === paymentId;

        if (shouldMovePointer) {
          nextLastPaymentId = '';
          for (const candidate of candidates) {
            const candidateSnapshot = await transaction.get(doc(db, 'payments', candidate.id));
            if (candidateSnapshot.exists()) {
              nextLastPaymentId = candidate.id;
              break;
            }
          }
        }

        // All transaction reads are complete before either write is queued.
        if (paymentSnapshot.exists()) transaction.delete(paymentRef);
        if (shouldMovePointer) {
          transaction.update(studentRef, { lastPaymentId: nextLastPaymentId });
        }

        return { nextLastPaymentId };
      });

      // Re-read after the transaction rather than stamping the pre-transaction
      // query as fresh. A different admin may have added a payment while this
      // deletion was in progress.
      const [paymentsReconciliation, studentReconciliation] = await Promise.allSettled([
        loadPaymentsForStudent(studentId, { force: true }),
        loadStudentById(studentId, { force: true }),
      ]);
      const reconciliationFailed =
        paymentsReconciliation.status === 'rejected'
        || studentReconciliation.status === 'rejected';
      const reconciledPayments = paymentsReconciliation.status === 'fulfilled'
        ? paymentsReconciliation.value
        : freshPayments.filter(payment => payment.id !== paymentId);
      const reconciledStudent = studentReconciliation.status === 'fulfilled'
        ? studentReconciliation.value
        : student
          ? { ...student, lastPaymentId: transactionResult.nextLastPaymentId }
          : null;
      const reconciledLastPaymentId = reconciledStudent?.lastPaymentId
        ?? transactionResult.nextLastPaymentId;
      if (isStaff) {
        setScopedPayments(reconciledPayments);
        setScopedPaymentsKey(studentId);
        setScopedPaymentsLoadedAt(
          paymentsReconciliation.status === 'fulfilled' ? Date.now() : null
        );
        setScopedPaymentsError(
          paymentsReconciliation.status === 'rejected'
            ? 'Payment was deleted, but the latest payments could not be reloaded. Use Refresh.'
            : ''
        );
        setScopedStudent(reconciledStudent);
        setScopedStudentKey(studentId);
        setScopedStudentLoadedAt(
          studentReconciliation.status === 'fulfilled' ? Date.now() : null
        );
        setScopedStudentError(
          studentReconciliation.status === 'rejected'
            ? 'Payment was deleted, but the latest student record could not be reloaded. Use Refresh.'
            : ''
        );
      }
      removePayment(paymentId);
      patchStudent(studentId, { lastPaymentId: reconciledLastPaymentId });
      invalidateSalarySummaries();

      if (paymentsReconciliation.status === 'rejected') {
        console.error('Failed to reconcile payments after deletion:', paymentsReconciliation.reason);
      }
      if (studentReconciliation.status === 'rejected') {
        console.error('Failed to reconcile student after payment deletion:', studentReconciliation.reason);
      }
      alert(reconciliationFailed
        ? '✅ Payment deleted. Latest data could not be reloaded; please use Refresh.'
        : '✅ Payment deleted');
      setCurrentIndex(0);
    } catch (err) {
      alert('❌ Error deleting payment');
      console.error(err);
    } finally {
      paymentDeletionInProgress.current = false;
      setDeletingPayment(false);
    }
  };

  const handleDeleteStudent = async () => {
    if (
      deletingStudent
      || deletingPayment
      || studentDeletionInProgress.current
      || paymentDeletionInProgress.current
    ) return;
    if (!window.confirm('Are you sure you want to delete this student?')) return;

    const second = prompt('⚠️ Type DELETE to confirm.');
    if (second !== 'DELETE') {
      alert('❌ Deletion canceled');
      return;
    }

    studentDeletionInProgress.current = true;
    setDeletingStudent(true);
    try {
      await deleteDoc(doc(db, 'students', studentId));
      removeStudent(studentId);
      invalidateSalarySummaries();
      alert('✅ Student deleted');
      navigate('/students');
    } catch (err) {
      alert('❌ Error deleting student');
      console.error(err);
    } finally {
      studentDeletionInProgress.current = false;
      setDeletingStudent(false);
    }
  };

  const handleAddPayment = () => {
    if (!isStaff || !student) return;
    navigate(`/add-payment?studentId=${encodeURIComponent(student.id)}`);
  };

  const handleAddOtherPayment = () => {
    if (!isAdmin || !student) return;
    const returnTo = encodeURIComponent(`/student/${student.id}`);
    navigate(`/add-payment?studentId=${encodeURIComponent(student.id)}&mode=other&returnTo=${returnTo}`);
  };

  const handleAddWorkshopPayment = () => {
    if (!isStaff || !student) return;
    navigate(`/add-payment?mode=workshop&studentId=${encodeURIComponent(student.id)}`);
  };

  const handleAddProjectPayment = () => {
    if (!isStaff || !student) return;
    navigate(`/add-payment?mode=project&studentId=${encodeURIComponent(student.id)}`);
  };

  const handleDeleteProjectPayment = async payment => {
    if (!isAdmin || deletingProjectPaymentId || !payment?.id || !payment?.projectId) return;
    if (!window.confirm('Are you sure you want to delete this project payment?')) return;
    setDeletingProjectPaymentId(payment.id);
    try {
      await deleteDoc(doc(db, `projects/${payment.projectId}/payments`, payment.id));
      setProjectPayments(current => current.filter(item => !(
        item.id === payment.id && item.projectId === payment.projectId
      )));
      invalidateProjectPaymentHistory();
      invalidateSalarySummaries();
      alert('✅ Project payment deleted');
    } catch (error) {
      console.error('Failed to delete project payment:', error);
      alert('❌ Error deleting project payment');
    } finally {
      setDeletingProjectPaymentId('');
    }
  };

  const handleDeleteWorkshopPayment = async payment => {
    if (!isAdmin || deletingWorkshopPaymentId || !payment?.id || !payment?.workshopId) return;
    if (!window.confirm('Are you sure you want to delete this workshop payment?')) return;
    setDeletingWorkshopPaymentId(payment.id);
    try {
      await deleteDoc(doc(db, `workshops/${payment.workshopId}/payments`, payment.id));
      setWorkshopPayments(current => current.filter(item => !(
        item.id === payment.id && item.workshopId === payment.workshopId
      )));
      invalidateWorkshopPaymentHistory();
      invalidateSalarySummaries();
      alert('✅ Workshop payment deleted');
    } catch (error) {
      console.error('Failed to delete workshop payment:', error);
      alert('❌ Error deleting workshop payment');
    } finally {
      setDeletingWorkshopPaymentId('');
    }
  };

  const handleDeleteOtherPayment = async (payment) => {
    if (!isAdmin || deletingOtherPaymentId || !payment?.id || !payment?.month) return;
    if (!window.confirm('Are you sure you want to delete this other payment?')) return;

    setDeletingOtherPaymentId(payment.id);
    try {
      await updateDoc(
        doc(db, 'otherpayments', payment.month),
        new FieldPath('payments', payment.id),
        deleteField()
      );
      setOtherPayments(current => current.filter(item => item.id !== payment.id));
      invalidateOtherPaymentHistory();
      invalidateSalarySummaries();
      alert('✅ Other payment deleted');
    } catch (error) {
      console.error('Failed to delete other payment:', error);
      alert('❌ Error deleting other payment');
    } finally {
      setDeletingOtherPaymentId('');
    }
  };

  const isStudentAccount = user?.role !== 'admin' && user?.role !== 'coach';

  const handleRefreshStudents = async () => {
    try {
      if (isStaff) return await loadScopedStudent({ force: true });
      return await refreshStudents();
    } catch (err) {
      console.error('Failed to refresh students:', err);
    }
  };

  const handleRefreshPayments = async () => {
    try {
      if (isStaff) return await loadScopedPayments({ force: true });
      return await refreshPayments();
    } catch (err) {
      console.error('Failed to refresh payments:', err);
    }
  };

  const handleRefreshDetail = async () => {
    if (detailRefreshInProgress.current) return;
    detailRefreshInProgress.current = true;
    setRefreshingDetail(true);
    try {
      await Promise.allSettled([
        handleRefreshStudents(),
        handleRefreshPayments(),
        ...(isAdmin ? [loadOtherPayments({ force: true })] : []),
        ...(isStaff ? [loadWorkshopPayments({ force: true })] : []),
        ...(isStaff ? [loadProjectPayments({ force: true })] : []),
      ]);
    } finally {
      detailRefreshInProgress.current = false;
      setRefreshingDetail(false);
    }
  };

  const detailDataLoading =
    refreshingDetail || studentDataLoading || paymentDataLoading || otherPaymentsLoading || workshopPaymentsLoading || projectPaymentsLoading;
  const formatCheckedAt = timestamp => timestamp
    ? new Date(timestamp).toLocaleString()
    : 'not updated yet';
  const detailDataStatus = (
    <RefreshStatus
      message={(studentDataLoadedAt || paymentDataLoadedAt)
        ? formatCheckedAt(Math.max(studentDataLoadedAt || 0, paymentDataLoadedAt || 0))
        : 'Not updated yet'}
      error={(studentDataError || paymentDataError)
        ? [
            studentDataError ? `Student: ${studentDataError}` : '',
            paymentDataError ? `Payments: ${paymentDataError}` : '',
          ].filter(Boolean).join(' · ')
        : ''}
      loading={detailDataLoading}
      onRefresh={handleRefreshDetail}
      refreshLabel="Refresh student data"
    />
  );
  const paymentViewToggle = isStaff ? (
    <div className="student-payment-view-toggle" aria-label="Payment type">
      <button
        type="button"
        className={paymentDetailView === 'group' ? 'active' : ''}
        aria-pressed={paymentDetailView === 'group'}
        onClick={() => setPaymentDetailView('group')}
      >
        Group
      </button>
      <button
        type="button"
        className={paymentDetailView === 'workshop' ? 'active' : ''}
        aria-pressed={paymentDetailView === 'workshop'}
        onClick={() => setPaymentDetailView('workshop')}
      >
        Workshops
      </button>
      <button
        type="button"
        className={paymentDetailView === 'project' ? 'active' : ''}
        aria-pressed={paymentDetailView === 'project'}
        onClick={() => setPaymentDetailView('project')}
      >
        Projects
      </button>
      {isAdmin && (
      <button
        type="button"
        className={paymentDetailView === 'other' ? 'active' : ''}
        aria-pressed={paymentDetailView === 'other'}
        onClick={() => setPaymentDetailView('other')}
      >
        Other
      </button>
      )}
    </div>
  ) : null;
  const otherPaymentsSection = isAdmin ? (
    <section className="student-other-payments" aria-labelledby="student-other-payments-title">
      <div className="student-other-payments-header">
        <div>
          <h3 id="student-other-payments-title">OTHER PAYMENTS</h3>
          <span>{studentOtherPayments.length} total</span>
        </div>
        <button
          type="button"
          className="student-other-payment-add"
          onClick={handleAddOtherPayment}
          disabled={!student || deletingOtherPaymentId !== ''}
        >
          + Add other
        </button>
      </div>

      {otherPaymentsLoading && studentOtherPayments.length === 0 && (
        <p className="student-other-payments-message">Loading other payments…</p>
      )}
      {otherPaymentsError && (
        <div className="student-other-payments-error" role="alert">
          <span>{otherPaymentsError}</span>
          <button
            type="button"
            onClick={() => loadOtherPayments({ force: true }).catch(() => {})}
          >
            Retry
          </button>
        </div>
      )}
      {!otherPaymentsLoading && !otherPaymentsError && studentOtherPayments.length === 0 && (
        <p className="student-other-payments-message">No other payments.</p>
      )}

      {studentOtherPayments.length > 0 && (
        <ul className="student-other-payments-list">
          {studentOtherPayments.map(payment => (
            <li
              key={`${payment.month}-${payment.id}`}
              ref={payment.id === otherPaymentIdFromHistory ? selectedOtherPaymentElement : null}
              className={`student-other-payment-row${payment.id === otherPaymentIdFromHistory ? ' is-selected' : ''}`}
            >
              <div className="student-other-payment-summary">
                <div>
                  <strong>{getOtherPaymentReasonLabel(payment.reason)}</strong>
                  <span>Date from: {payment.dateFrom}</span>
                  <span>Paid: {payment.createdAt}</span>
                  <span>Paid by: {getPaymentMethodLabel(payment.paymentMethod)}</span>
                </div>
                <strong className="student-other-payment-amount">
                  {Number(payment.amount).toFixed(2)}€
                </strong>
              </div>
              <button
                type="button"
                className="student-other-payment-delete"
                onClick={() => handleDeleteOtherPayment(payment)}
                disabled={Boolean(deletingOtherPaymentId)}
              >
                {deletingOtherPaymentId === payment.id ? 'Deleting…' : 'Delete'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  ) : null;
  const workshopPaymentsSection = isStaff ? (
    <section className="student-other-payments" aria-labelledby="student-workshop-payments-title">
      <div className="student-other-payments-header">
        <div><h3 id="student-workshop-payments-title">WORKSHOP PAYMENTS</h3><span>{studentWorkshopPayments.length} total</span></div>
        <button type="button" className="student-other-payment-add" onClick={handleAddWorkshopPayment} disabled={!student}>+ Add workshop</button>
      </div>
      {workshopPaymentsLoading && studentWorkshopPayments.length === 0 && <p className="student-other-payments-message">Loading workshop payments…</p>}
      {workshopPaymentsError && <div className="student-other-payments-error" role="alert"><span>{workshopPaymentsError}</span><button type="button" onClick={() => loadWorkshopPayments({ force: true }).catch(() => {})}>Retry</button></div>}
      {!workshopPaymentsLoading && !workshopPaymentsError && studentWorkshopPayments.length === 0 && <p className="student-other-payments-message">No workshop payments.</p>}
      {studentWorkshopPayments.length > 0 && <ul className="student-other-payments-list">{studentWorkshopPayments.map(payment => {
        const workshop = workshopsById.get(payment.workshopId);
        const isSelected = payment.id === workshopPaymentIdFromHistory && payment.workshopId === workshopIdFromHistory;
        return <li key={`${payment.workshopId}-${payment.id}`} ref={isSelected ? selectedWorkshopPaymentElement : null} className={`student-other-payment-row${isSelected ? ' is-selected' : ''}`}>
          <div className="student-other-payment-summary"><div><strong>{workshop?.name || payment.workshopName || payment.workshopId}</strong><span>Workshop: {payment.dateFrom}</span><span>Paid: {payment.createdAt}</span><span>Paid by: {getPaymentMethodLabel(payment.paymentMethod)}</span></div><strong className="student-other-payment-amount">{Number(payment.amount).toFixed(2)}€</strong></div>
          {isAdmin && <button type="button" className="student-other-payment-delete" onClick={() => handleDeleteWorkshopPayment(payment)} disabled={Boolean(deletingWorkshopPaymentId)}>{deletingWorkshopPaymentId === payment.id ? 'Deleting…' : 'Delete'}</button>}
        </li>;
      })}</ul>}
    </section>
  ) : null;
  const projectPaymentsSection = isStaff ? (
    <section className="student-other-payments" aria-labelledby="student-project-payments-title">
      <div className="student-other-payments-header"><div><h3 id="student-project-payments-title">PROJECT PAYMENTS</h3><span>{studentProjectPayments.length} total</span></div><button type="button" className="student-other-payment-add" onClick={handleAddProjectPayment} disabled={!student}>+ Add project</button></div>
      {projectPaymentsLoading && studentProjectPayments.length === 0 && <p className="student-other-payments-message">Loading project payments…</p>}
      {projectPaymentsError && <div className="student-other-payments-error" role="alert"><span>{projectPaymentsError}</span><button type="button" onClick={() => loadProjectPayments({ force: true }).catch(() => {})}>Retry</button></div>}
      {!projectPaymentsLoading && !projectPaymentsError && studentProjectPayments.length === 0 && <p className="student-other-payments-message">No project payments.</p>}
      {studentProjectPayments.length > 0 && <ul className="student-other-payments-list">{studentProjectPayments.map(payment => {
        const project = projectsById.get(payment.projectId);
        const isSelected = payment.id === projectPaymentIdFromHistory && payment.projectId === projectIdFromHistory;
        return <li key={`${payment.projectId}-${payment.id}`} ref={isSelected ? selectedProjectPaymentElement : null} className={`student-other-payment-row${isSelected ? ' is-selected' : ''}`}><div className="student-other-payment-summary"><div><strong>{project?.name || payment.projectName || payment.projectId}</strong><span>{PROJECT_PAYMENT_PART_LABELS[payment.paymentPart] || 'Full payment'}</span><span>Project starts: {payment.dateFrom}</span><span>Paid: {payment.createdAt} · {getPaymentMethodLabel(payment.paymentMethod)}</span></div><strong className="student-other-payment-amount">{Number(payment.amount).toFixed(2)}€</strong></div>{isAdmin && <button type="button" className="student-other-payment-delete" onClick={() => handleDeleteProjectPayment(payment)} disabled={Boolean(deletingProjectPaymentId)}>{deletingProjectPaymentId === payment.id ? 'Deleting…' : 'Delete'}</button>}</li>;
      })}</ul>}
    </section>
  ) : null;

  if (!studentDataLoaded) {
    if (studentDataError) {
      return (
        <div>
          <RefreshStatus
            message="Student has not been loaded yet"
            error={studentDataError}
            loading={studentDataLoading}
            onRefresh={handleRefreshStudents}
            refreshLabel="Retry student"
            loadingLabel="Retrying…"
          />
        </div>
      );
    }
    return <div>Loading student...</div>;
  }

  if (!student) {
    return (
      <div>
        <p>Student not found.</p>
        <RefreshStatus
          message="The student was not found in the latest data"
          onRefresh={handleRefreshStudents}
          loading={studentDataLoading}
          refreshLabel="Refresh student"
        />
        {isStudentAccount && (
          <button type="button" onClick={() => setUser(null)}>
            Log out
          </button>
        )}
      </div>
    );
  }

  if (!paymentDataLoaded) {
    if (paymentDataError) {
      return (
        <div>
          <RefreshStatus
            message="Payments have not been loaded yet"
            error={paymentDataError}
            loading={paymentDataLoading}
            onRefresh={handleRefreshPayments}
            refreshLabel="Retry payments"
            loadingLabel="Retrying…"
          />
        </div>
      );
    }
    return <div>Loading payments for {student.name}...</div>;
  }

  if (!currentPayment) {
    return (
      <div>
        {detailDataStatus}
        {paymentViewToggle}
        <div className="student-card" hidden={paymentDetailView !== 'group'}>
          <div className="top-row">
            <p>{student.phone}</p>
            {isStudentAccount && (
              <button className="close-btn" onClick={() => setUser(null)}>✕</button>
            )}
          </div>
          <h2>{student.name.toUpperCase()}</h2>
          <StudentContacts />
          <h3>No payments.</h3>
          {(user?.role === 'admin' || user?.role === 'coach') && (
            <button
              onClick={handleAddPayment}
              disabled={deletingStudent}
            >
              ➕ ADD PAYMENT
            </button>
          )}
        </div>

        {paymentDetailView === 'other' && otherPaymentsSection}
        {paymentDetailView === 'workshop' && workshopPaymentsSection}
        {paymentDetailView === 'project' && projectPaymentsSection}

        {user?.role === 'admin' && (
          <div style={{ marginTop: '10px', textAlign: 'center' }}>
            <button
              onClick={handleDeleteStudent}
              style={{ background: 'red', color: 'white' }}
              disabled={deletingStudent}
            >
              {deletingStudent ? 'DELETING STUDENT…' : 'DELETE STUDENT'}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {detailDataStatus}
      {paymentViewToggle}
      <div className="student-card" hidden={paymentDetailView !== 'group'}>
        <div className="top-row">
          <p>{student.phone}</p>
          {user?.role !== 'coach' && user?.role !== 'admin' && (
            <button className="close-btn" onClick={() => setUser(null)}>✕</button>
          )}
        </div>

        {(user?.role === 'admin' || user?.role === 'coach') && <p>{student.id}</p>}

        <h2>{student.name.toUpperCase()}</h2>
        <StudentContacts />
        {currentPayment?.createdAt && <p>PAYMENT DATE: {currentPayment.createdAt}</p>}
        <p>PAID BY: {getPaymentMethodLabel(currentPayment?.paymentMethod).toUpperCase()}</p>
        <p>
          START DATE: {currentPayment.dateFrom}
          {currentPayment.timeFrom ? ` ${currentPayment.timeFrom}` : ''}
        </p>
        <h1 className="price">{currentPayment.amount}€</h1>

        <div className="payment-group-list">
          GROUPS:
          {(currentPayment.groups || []).map(gid => {
            const g = groups.find(gr => gr.id === gid);
            return <div key={gid}>{g?.name || gid}</div>;
          })}
        </div>

        <h3 className="amount">CLASSES AMOUNT: {currentPayment.type}</h3>
        <h5 className="warning">*the class dates may differ due to rescheduling.</h5>

        {loadingClasses || classesPaymentKey !== currentPayment.id ? (
          <p>Loading classes...</p>
        ) : classesError ? (
          <div role="alert">
            <p>{classesError}</p>
            <button type="button" onClick={() => setClassesLoadAttempt(attempt => attempt + 1)}>
              Retry classes
            </button>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>DATE</th>
                <th>GROUP</th>
                <th>ATTENDED</th>
              </tr>
            </thead>
            <tbody>
              {classes.length > 0 ? (
                classes.map((c, index) => (
                  <tr
                    key={`${c.groupId}-${c.date}-${index}`}
                    className="payment-class-row"
                    role="link"
                    tabIndex={0}
                    onClick={() => navigate(`/group/${c.groupId}/class/${c.date}`)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        navigate(`/group/${c.groupId}/class/${c.date}`);
                      }
                    }}
                  >
                    <td>{index + 1}</td>
                    <td>{c.date}</td>
                    <td>{c.groupName}</td>
                    <td>{getAttendanceIcon(c.groupId, c.date, c.groupTime)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="4">No classes found for this payment.</td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {user?.role === 'admin' && (
          <div className="delete-button">
            <button
              type="button"
              onClick={handleDelete}
              disabled={deletingPayment || deletingStudent}
            >
              {deletingPayment ? 'Deleting…' : '🗑'}
            </button>
          </div>
        )}

        <div className="swipe-controls">
          {boundedCurrentIndex < studentPayments.length - 1 && (
            <button
              onClick={() => setCurrentIndex(boundedCurrentIndex + 1)}
              disabled={deletingPayment}
            >
              ← Prev
            </button>
          )}
          {boundedCurrentIndex > 0 && (
            <button
              onClick={() => setCurrentIndex(boundedCurrentIndex - 1)}
              disabled={deletingPayment}
            >
              Next →
            </button>
          )}
        </div>
      </div>

      {paymentDetailView === 'other' && otherPaymentsSection}
      {paymentDetailView === 'workshop' && workshopPaymentsSection}
      {paymentDetailView === 'project' && projectPaymentsSection}

      <div>
        {(user?.role === 'coach' || (isAdmin && paymentDetailView === 'group')) && (
          <div style={{ textAlign: 'center', marginTop: '20px' }}>
            <button
              onClick={handleAddPayment}
              style={{ padding: '8px 16px' }}
              disabled={deletingPayment || deletingStudent}
            >
              ➕ ADD PAYMENT
            </button>
          </div>
        )}
        {user?.role === 'admin' && (
          <div style={{ marginTop: '10px', textAlign: 'center' }}>
            <button
              onClick={handleDeleteStudent}
              style={{ background: 'red', color: 'white' }}
              disabled={deletingStudent || deletingPayment}
            >
              {deletingStudent ? 'DELETING STUDENT…' : 'DELETE STUDENT'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default StudentDetailPage;
