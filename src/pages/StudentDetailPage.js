import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { deleteDoc, doc, runTransaction } from 'firebase/firestore';
import { useData } from '../context/firebase';
import { useUser } from '../context/UserContext';
import './StudentDetailPage.css';
import { getPaymentClasses, isClassUpcoming } from '../utils/paymentsUtils';
import { invalidateSalarySummaries } from '../utils/salaryCache';

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
  const isStaff = user?.role === 'admin' || user?.role === 'coach';

  const [currentIndex, setCurrentIndex] = useState(0);
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
  const studentLoadGeneration = useRef(0);
  const paymentsLoadGeneration = useRef(0);
  const detailRefreshInProgress = useRef(false);
  const paymentDeletionInProgress = useRef(false);
  const studentDeletionInProgress = useRef(false);

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
    if (user?.role !== 'admin' || !student) return;
    navigate(`/add-payment?studentId=${encodeURIComponent(student.id)}`);
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
      ]);
    } finally {
      detailRefreshInProgress.current = false;
      setRefreshingDetail(false);
    }
  };

  const detailDataLoading =
    refreshingDetail || studentDataLoading || paymentDataLoading;
  const formatCheckedAt = timestamp => timestamp
    ? new Date(timestamp).toLocaleString()
    : 'not checked yet';
  const detailDataStatus = (
    <div role="status" style={{ textAlign: 'center', marginBottom: '12px' }}>
      {(studentDataError || paymentDataError) && (
        <p style={{ color: '#9c0000' }}>
          {studentDataError && `Student: ${studentDataError}`}
          {studentDataError && paymentDataError && ' | '}
          {paymentDataError && `Payments: ${paymentDataError}`}
        </p>
      )}
      <small>
        Student checked: {formatCheckedAt(studentDataLoadedAt)}; payments checked:{' '}
        {formatCheckedAt(paymentDataLoadedAt)}
      </small>
      <br />
      <button type="button" onClick={handleRefreshDetail} disabled={detailDataLoading}>
        {detailDataLoading ? 'Refreshing…' : 'Refresh student data'}
      </button>
    </div>
  );

  if (!studentDataLoaded) {
    if (studentDataError) {
      return (
        <div>
          <p>{studentDataError}</p>
          <button type="button" onClick={handleRefreshStudents} disabled={studentDataLoading}>
            Retry students
          </button>
        </div>
      );
    }
    return <div>Loading student...</div>;
  }

  if (!student) {
    return (
      <div>
        <p>Student not found.</p>
        <button type="button" onClick={handleRefreshStudents}>
          Refresh students
        </button>
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
          <p>{paymentDataError}</p>
          <button type="button" onClick={handleRefreshPayments} disabled={paymentDataLoading}>
            Retry payments
          </button>
        </div>
      );
    }
    return <div>Loading payments for {student.name}...</div>;
  }

  if (!currentPayment) {
    return (
      <div>
        {detailDataStatus}
        <div className="student-card">
          <div className="top-row">
            <p>{student.phone}</p>
            {isStudentAccount && (
              <button className="close-btn" onClick={() => setUser(null)}>✕</button>
            )}
          </div>
          <h2>{student.name.toUpperCase()}</h2>
          <StudentContacts />
          <h3>No payments.</h3>
          {user?.role === 'admin' && (
            <button
              onClick={handleAddPayment}
              disabled={deletingStudent}
            >
              ➕ ADD PAYMENT
            </button>
          )}
        </div>

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
      <div className="student-card">
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
        <p>
          START DATE: {currentPayment.dateFrom}
          {currentPayment.timeFrom ? ` ${currentPayment.timeFrom}` : ''}
        </p>
        <h1 className="price">{currentPayment.amount}€</h1>

        <div className="group-list">
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

      {user?.role === 'admin' && (
        <div>
          <div style={{ textAlign: 'center', marginTop: '20px' }}>
            <button
              onClick={handleAddPayment}
              style={{ padding: '8px 16px' }}
              disabled={deletingPayment || deletingStudent}
            >
              ➕ ADD PAYMENT
            </button>
          </div>
          <div style={{ marginTop: '10px', textAlign: 'center' }}>
            <button
              onClick={handleDeleteStudent}
              style={{ background: 'red', color: 'white' }}
              disabled={deletingStudent || deletingPayment}
            >
              {deletingStudent ? 'DELETING STUDENT…' : 'DELETE STUDENT'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default StudentDetailPage;
