import React, {
  useState,
  useEffect,
  useLayoutEffect,
  createContext,
  useContext,
  useCallback,
  useRef,
} from 'react';
import {
  getFirestore,
  collection,
  doc,
  onSnapshot,
  getDocFromServer,
  getDocsFromServer,
  query,
  where,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { initializeApp } from 'firebase/app';
import { useLocation } from 'react-router-dom';
import { useUser } from './UserContext';
import {
  invalidateReadCache,
  markReadCacheChanged,
} from '../utils/readCacheEpoch';

const firebaseConfig = {
  apiKey: "AIzaSyDz7sIUO3ep9hZB__8uK0ZAd4UJDbb-mLQ",
  authDomain: "dance-power-cef6d.firebaseapp.com",
  projectId: "dance-power-cef6d",
  storageBucket: "dance-power-cef6d.firebasestorage.app",
  messagingSenderId: "872869280436",
  appId: "1:872869280436:web:a61d17413f2bc24b54f5e1",
  measurementId: "G-FGJ6F17FS8"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

const DataContext = createContext();
export const useData = () => useContext(DataContext);

export const auth = getAuth(app);

const configuredStaffCacheTtl = Number(
  process.env.REACT_APP_FIREBASE_READ_CACHE_TTL_MS
);

// Override at build time when a different freshness window is required.
export const STAFF_DATA_CACHE_TTL_MS =
  Number.isFinite(configuredStaffCacheTtl) && configuredStaffCacheTtl >= 0
    ? configuredStaffCacheTtl
    : 15 * 60 * 1000;

function createCancelledDataRequestError() {
  const error = new Error('Data request cancelled because the active user changed.');
  error.name = 'AbortError';
  return error;
}

function staffRouteRequirements(pathname, role) {
  const normalizedPath = pathname.length > 1
    ? pathname.replace(/\/+$/, '')
    : pathname;
  const isClassDetail = /^\/group\/[^/]+\/class\/[^/]+$/.test(normalizedPath);
  const isPaymentHistory = normalizedPath === '/payment-history';
  const isProjectDetail = /^\/project\/[^/]+$/.test(normalizedPath);
  const isProjectWaitingList = normalizedPath === '/project-waiting-list';
  const isWorkshopDetail = /^\/workshop\/[^/]+$/.test(normalizedPath);
  const isGroupDetails = /^\/group\/[^/]+\/details$/.test(normalizedPath);

  return {
    students:
      normalizedPath === '/students' ||
      (normalizedPath === '/add-payment' && (role === 'admin' || role === 'coach')) ||
      isClassDetail ||
      isGroupDetails ||
      isPaymentHistory ||
      isProjectDetail ||
      isProjectWaitingList ||
      isWorkshopDetail,
    payments: isClassDetail || isPaymentHistory,
  };
}

function upsertById(items, item) {
  if (!item?.id) return items;
  const index = items.findIndex(current => current.id === item.id);
  if (index < 0) return [...items, item];
  const next = [...items];
  next[index] = { ...items[index], ...item, id: item.id };
  return next;
}

function patchById(items, id, changesOrUpdater) {
  if (!id) return items;
  const index = items.findIndex(current => current.id === id);
  if (index < 0) return items;

  const current = items[index];
  const changes = typeof changesOrUpdater === 'function'
    ? changesOrUpdater(current)
    : changesOrUpdater;
  if (!changes || typeof changes !== 'object') return items;

  const next = [...items];
  next[index] = { ...current, ...changes, id };
  return next;
}

export function DataProvider({ children }) {
  const { user } = useUser();
  const { pathname } = useLocation();
  const [groups, setGroups] = useState([]);
  const [projects, setProjects] = useState([]);
  const [workshops, setWorkshops] = useState([]);
  const [students, setStudents] = useState([]);
  const [payments, setPayments] = useState([]);
  const [classes, setClasses] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [groupsLoaded, setGroupsLoaded] = useState(false);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [workshopsLoaded, setWorkshopsLoaded] = useState(false);
  const [coachesLoaded, setCoachesLoaded] = useState(false);
  const [groupsError, setGroupsError] = useState(null);
  const [projectsError, setProjectsError] = useState(null);
  const [workshopsError, setWorkshopsError] = useState(null);
  const [coachesError, setCoachesError] = useState(null);
  const [studentsLoaded, setStudentsLoaded] = useState(false);
  const [paymentsLoaded, setPaymentsLoaded] = useState(false);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [studentsError, setStudentsError] = useState(null);
  const [paymentsError, setPaymentsError] = useState(null);
  const [studentsLastLoadedAt, setStudentsLastLoadedAt] = useState(null);
  const [paymentsLastLoadedAt, setPaymentsLastLoadedAt] = useState(null);
  const pastClassesByGroup = useRef(new Map());
  const pastClassesLoadedAt = useRef(new Map());
  const pastClassRequests = useRef(new Map());
  const pastClassVersions = useRef(new Map());
  const scheduleCache = useRef(new Map());
  const replacementCache = useRef(new Map());
  const coachTasksCache = useRef(new Map());
  const studentsRef = useRef([]);
  const paymentsRef = useRef([]);
  const studentsLoadedRef = useRef(false);
  const paymentsLoadedRef = useRef(false);
  const studentsLastLoadedAtRef = useRef(null);
  const paymentsLastLoadedAtRef = useRef(null);
  const studentsRequest = useRef(null);
  const paymentsRequest = useRef(null);
  const studentsByIdCache = useRef(new Map());
  const studentByIdRequests = useRef(new Map());
  const paymentsByStudentCache = useRef(new Map());
  const paymentsByStudentRequests = useRef(new Map());
  const dataGeneration = useRef(0);
  const activeSubscriptionKey = useRef(null);
  const isStaff = user?.role === 'admin' || user?.role === 'coach';
  const subscriptionKey = !user
    ? 'signed-out'
    : isStaff
      ? `${user.id || 'staff'}:staff`
      : `${user.role}:student`;
  const latestDataScope = useRef(null);
  if (latestDataScope.current?.subscriptionKey !== subscriptionKey) {
    // A new object is created for every account transition. Object identity,
    // unlike the string key, also distinguishes logout + login as the same
    // account while work from its previous session is still completing.
    latestDataScope.current = { subscriptionKey };
  }
  const dataScope = latestDataScope.current;

  const isCurrentDataScope = useCallback(
    () => latestDataScope.current === dataScope,
    [dataScope]
  );

  const replaceStudents = useCallback((nextOrUpdater) => {
    const next = typeof nextOrUpdater === 'function'
      ? nextOrUpdater(studentsRef.current)
      : nextOrUpdater;
    studentsRef.current = next;
    setStudents(next);
    return next;
  }, []);

  const replacePayments = useCallback((nextOrUpdater) => {
    const next = typeof nextOrUpdater === 'function'
      ? nextOrUpdater(paymentsRef.current)
      : nextOrUpdater;
    paymentsRef.current = next;
    setPayments(next);
    return next;
  }, []);

  const loadStudentsData = useCallback(({ force = false } = {}) => {
    if (!isCurrentDataScope()) {
      return Promise.reject(createCancelledDataRequestError());
    }
    if (!user) return Promise.resolve([]);
    if (!isStaff && !force) return Promise.resolve(studentsRef.current);
    if (
      studentsRequest.current?.scope === dataScope &&
      studentsRequest.current?.generation === dataGeneration.current
    ) {
      return studentsRequest.current.promise;
    }

    if (isStaff) {
      const lastLoadedAt = studentsLastLoadedAtRef.current;
      const isFresh =
        studentsLoadedRef.current &&
        lastLoadedAt !== null &&
        Date.now() - lastLoadedAt < STAFF_DATA_CACHE_TTL_MS;
      if (!force && isFresh) return Promise.resolve(studentsRef.current);
    }

    const generation = dataGeneration.current;
    const requestState = {
      generation,
      subscriptionKey,
      scope: dataScope,
      promise: null,
      transforms: [],
    };
    setStudentsLoading(true);
    setStudentsError(null);

    const source = isStaff
      ? getDocsFromServer(collection(db, 'students'))
      : getDocFromServer(doc(db, 'students', user.role));

    const request = source
      .then(snapshot => {
        if (
          dataGeneration.current !== generation ||
          latestDataScope.current !== requestState.scope
        ) {
          throw createCancelledDataRequestError();
        }

        let nextStudents = isStaff
          ? snapshot.docs.map(item => ({ id: item.id, ...item.data() }))
          : snapshot.exists()
            ? [{ id: snapshot.id, ...snapshot.data() }]
            : [];

        for (const transform of requestState.transforms) {
          nextStudents = transform(nextStudents);
        }

        if (
          dataGeneration.current !== generation ||
          latestDataScope.current !== requestState.scope
        ) {
          throw createCancelledDataRequestError();
        }

        const loadedAt = Date.now();
        studentsByIdCache.current.clear();
        replaceStudents(nextStudents);
        studentsLoadedRef.current = true;
        studentsLastLoadedAtRef.current = loadedAt;
        setStudentsLoaded(true);
        setStudentsLastLoadedAt(loadedAt);
        setStudentsError(null);
        return nextStudents;
      })
      .catch(error => {
        if (
          dataGeneration.current === generation &&
          latestDataScope.current === requestState.scope
        ) {
          setStudentsError(error?.message || String(error));
        }
        throw error;
      })
      .finally(() => {
        if (studentsRequest.current === requestState) studentsRequest.current = null;
        if (
          dataGeneration.current === generation &&
          latestDataScope.current === requestState.scope
        ) {
          setStudentsLoading(false);
        }
      });

    requestState.promise = request;
    studentsRequest.current = requestState;
    return request;
  }, [dataScope, isCurrentDataScope, isStaff, replaceStudents, subscriptionKey, user]);

  const loadPaymentsData = useCallback(({ force = false } = {}) => {
    if (!isCurrentDataScope()) {
      return Promise.reject(createCancelledDataRequestError());
    }
    if (!user) return Promise.resolve([]);
    if (!isStaff && !force) return Promise.resolve(paymentsRef.current);
    if (
      paymentsRequest.current?.scope === dataScope &&
      paymentsRequest.current?.generation === dataGeneration.current
    ) {
      return paymentsRequest.current.promise;
    }

    if (isStaff) {
      const lastLoadedAt = paymentsLastLoadedAtRef.current;
      const isFresh =
        paymentsLoadedRef.current &&
        lastLoadedAt !== null &&
        Date.now() - lastLoadedAt < STAFF_DATA_CACHE_TTL_MS;
      if (!force && isFresh) return Promise.resolve(paymentsRef.current);
    }

    const generation = dataGeneration.current;
    const requestState = {
      generation,
      subscriptionKey,
      scope: dataScope,
      promise: null,
      transforms: [],
    };
    setPaymentsLoading(true);
    setPaymentsError(null);

    const source = isStaff
      ? getDocsFromServer(collection(db, 'payments'))
      : getDocsFromServer(query(collection(db, 'payments'), where('studentId', '==', user.role)));

    const request = source
      .then(snapshot => {
        if (
          dataGeneration.current !== generation ||
          latestDataScope.current !== requestState.scope
        ) {
          throw createCancelledDataRequestError();
        }

        let nextPayments = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
        for (const transform of requestState.transforms) {
          nextPayments = transform(nextPayments);
        }

        if (
          dataGeneration.current !== generation ||
          latestDataScope.current !== requestState.scope
        ) {
          throw createCancelledDataRequestError();
        }

        const loadedAt = Date.now();
        paymentsByStudentCache.current.clear();
        replacePayments(nextPayments);
        paymentsLoadedRef.current = true;
        paymentsLastLoadedAtRef.current = loadedAt;
        setPaymentsLoaded(true);
        setPaymentsLastLoadedAt(loadedAt);
        setPaymentsError(null);
        return nextPayments;
      })
      .catch(error => {
        if (
          dataGeneration.current === generation &&
          latestDataScope.current === requestState.scope
        ) {
          setPaymentsError(error?.message || String(error));
        }
        throw error;
      })
      .finally(() => {
        if (paymentsRequest.current === requestState) paymentsRequest.current = null;
        if (
          dataGeneration.current === generation &&
          latestDataScope.current === requestState.scope
        ) {
          setPaymentsLoading(false);
        }
      });

    requestState.promise = request;
    paymentsRequest.current = requestState;
    return request;
  }, [dataScope, isCurrentDataScope, isStaff, replacePayments, subscriptionKey, user]);

  const loadStudentById = useCallback((studentId, { force = false } = {}) => {
    if (!isCurrentDataScope()) {
      return Promise.reject(createCancelledDataRequestError());
    }
    if (!studentId) return Promise.resolve(null);
    if (!isStaff && studentId !== user?.role) return Promise.resolve(null);

    const existingRequest = studentByIdRequests.current.get(studentId);
    if (
      existingRequest?.scope === dataScope &&
      existingRequest?.generation === dataGeneration.current
    ) {
      return existingRequest.promise;
    }
    if (
      studentsRequest.current?.scope === dataScope &&
      studentsRequest.current?.generation === dataGeneration.current
    ) {
      return studentsRequest.current.promise.then(allStudents =>
        allStudents.find(student => student.id === studentId) || null
      );
    }

    const fullCacheIsFresh =
      studentsLoadedRef.current &&
      studentsLastLoadedAtRef.current !== null &&
      Date.now() - studentsLastLoadedAtRef.current < STAFF_DATA_CACHE_TTL_MS;
    if (!force && fullCacheIsFresh) {
      return Promise.resolve(
        studentsRef.current.find(student => student.id === studentId) || null
      );
    }

    const cached = studentsByIdCache.current.get(studentId);
    if (
      !force &&
      cached &&
      Date.now() - cached.fetchedAt < STAFF_DATA_CACHE_TTL_MS
    ) {
      return Promise.resolve(cached.value);
    }

    const generation = dataGeneration.current;
    const fullCacheLoadedAtAtStart = studentsLastLoadedAtRef.current;
    const requestState = {
      generation,
      scope: dataScope,
      promise: null,
      transforms: [],
    };
    const request = getDocFromServer(doc(db, 'students', studentId))
      .then(snapshot => {
        if (
          dataGeneration.current !== generation ||
          latestDataScope.current !== requestState.scope
        ) {
          throw createCancelledDataRequestError();
        }

        let nextStudent = snapshot.exists()
          ? { id: snapshot.id, ...snapshot.data() }
          : null;
        for (const transform of requestState.transforms) {
          nextStudent = transform(nextStudent);
        }

        if (
          dataGeneration.current !== generation ||
          latestDataScope.current !== requestState.scope
        ) {
          throw createCancelledDataRequestError();
        }

        if (
          studentsLoadedRef.current &&
          studentsLastLoadedAtRef.current !== fullCacheLoadedAtAtStart
        ) {
          // A full snapshot completed after this point read started. Prefer it
          // and do not give the potentially older point result a newer TTL.
          return studentsRef.current.find(student => student.id === studentId) || null;
        }

        studentsByIdCache.current.set(studentId, {
          value: nextStudent,
          fetchedAt: Date.now(),
        });
        // Reconcile an already-loaded full cache, but never let a scoped read
        // that started first overwrite a newer full-collection snapshot.
        if (
          studentsLoadedRef.current &&
          studentsLastLoadedAtRef.current === fullCacheLoadedAtAtStart
        ) {
          replaceStudents(current => nextStudent
            ? upsertById(current, nextStudent)
            : current.filter(student => student.id !== studentId));
        }
        return nextStudent;
      })
      .finally(() => {
        if (studentByIdRequests.current.get(studentId) === requestState) {
          studentByIdRequests.current.delete(studentId);
        }
      });

    requestState.promise = request;
    studentByIdRequests.current.set(studentId, requestState);
    return request;
  }, [dataScope, isCurrentDataScope, isStaff, replaceStudents, user?.role]);

  const loadPaymentsForStudent = useCallback((studentId, { force = false } = {}) => {
    if (!isCurrentDataScope()) {
      return Promise.reject(createCancelledDataRequestError());
    }
    if (!studentId) return Promise.resolve([]);
    if (!isStaff && studentId !== user?.role) return Promise.resolve([]);

    const existingRequest = paymentsByStudentRequests.current.get(studentId);
    if (
      existingRequest?.scope === dataScope &&
      existingRequest?.generation === dataGeneration.current
    ) {
      return existingRequest.promise;
    }
    if (
      paymentsRequest.current?.scope === dataScope &&
      paymentsRequest.current?.generation === dataGeneration.current
    ) {
      return paymentsRequest.current.promise.then(allPayments =>
        allPayments.filter(payment => payment.studentId === studentId)
      );
    }

    const fullCacheIsFresh =
      paymentsLoadedRef.current &&
      paymentsLastLoadedAtRef.current !== null &&
      Date.now() - paymentsLastLoadedAtRef.current < STAFF_DATA_CACHE_TTL_MS;
    if (!force && fullCacheIsFresh) {
      return Promise.resolve(
        paymentsRef.current.filter(payment => payment.studentId === studentId)
      );
    }

    const cached = paymentsByStudentCache.current.get(studentId);
    if (
      !force &&
      cached &&
      Date.now() - cached.fetchedAt < STAFF_DATA_CACHE_TTL_MS
    ) {
      return Promise.resolve(cached.value);
    }

    const generation = dataGeneration.current;
    const fullCacheLoadedAtAtStart = paymentsLastLoadedAtRef.current;
    const requestState = {
      generation,
      scope: dataScope,
      promise: null,
      transforms: [],
    };
    const request = getDocsFromServer(query(
      collection(db, 'payments'),
      where('studentId', '==', studentId)
    ))
      .then(snapshot => {
        if (
          dataGeneration.current !== generation ||
          latestDataScope.current !== requestState.scope
        ) {
          throw createCancelledDataRequestError();
        }

        let nextPayments = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
        for (const transform of requestState.transforms) {
          nextPayments = transform(nextPayments);
        }

        if (
          dataGeneration.current !== generation ||
          latestDataScope.current !== requestState.scope
        ) {
          throw createCancelledDataRequestError();
        }

        if (
          paymentsLoadedRef.current &&
          paymentsLastLoadedAtRef.current !== fullCacheLoadedAtAtStart
        ) {
          return paymentsRef.current.filter(payment => payment.studentId === studentId);
        }

        paymentsByStudentCache.current.set(studentId, {
          value: nextPayments,
          fetchedAt: Date.now(),
        });
        if (
          paymentsLoadedRef.current &&
          paymentsLastLoadedAtRef.current === fullCacheLoadedAtAtStart
        ) {
          replacePayments(current => [
            ...current.filter(payment => payment.studentId !== studentId),
            ...nextPayments,
          ]);
        }
        return nextPayments;
      })
      .finally(() => {
        if (paymentsByStudentRequests.current.get(studentId) === requestState) {
          paymentsByStudentRequests.current.delete(studentId);
        }
      });

    requestState.promise = request;
    paymentsByStudentRequests.current.set(studentId, requestState);
    return request;
  }, [dataScope, isCurrentDataScope, isStaff, replacePayments, user?.role]);

  const refreshStudents = useCallback(
    () => loadStudentsData({ force: true }),
    [loadStudentsData]
  );

  const refreshPayments = useCallback(
    () => loadPaymentsData({ force: true }),
    [loadPaymentsData]
  );

  const upsertStudent = useCallback((student) => {
    if (!isCurrentDataScope()) return;
    const transform = current => upsertById(current, student);
    const scopedTransform = current => {
      if (!student?.id) return current;
      return current
        ? { ...current, ...student, id: student.id }
        : student;
    };
    if (
      studentsRequest.current?.generation === dataGeneration.current &&
      studentsRequest.current?.scope === dataScope
    ) {
      studentsRequest.current.transforms.push(transform);
    }
    const scopedRequest = studentByIdRequests.current.get(student?.id);
    if (
      scopedRequest?.generation === dataGeneration.current &&
      scopedRequest?.scope === dataScope
    ) {
      scopedRequest.transforms.push(scopedTransform);
    }
    if (student?.id) {
      const cached = studentsByIdCache.current.get(student.id);
      studentsByIdCache.current.set(student.id, {
        value: scopedTransform(cached?.value || null),
        fetchedAt: Date.now(),
      });
    }
    replaceStudents(transform);
  }, [dataScope, isCurrentDataScope, replaceStudents]);

  const patchStudent = useCallback((id, changesOrUpdater) => {
    if (!isCurrentDataScope() || !id) return;
    if (
      typeof changesOrUpdater !== 'function' &&
      (!changesOrUpdater || typeof changesOrUpdater !== 'object')
    ) return;

    // Keep functional updaters functional in the queued transform. A refresh
    // may contain fields written by somebody else after our cached copy was
    // loaded, so replay the merge against that incoming student rather than
    // freezing the updater's output from the stale cached object.
    const transform = current => patchById(current, id, changesOrUpdater);
    const scopedTransform = current => {
      if (!current || current.id !== id) return current;
      const changes = typeof changesOrUpdater === 'function'
        ? changesOrUpdater(current)
        : changesOrUpdater;
      if (!changes || typeof changes !== 'object') return current;
      return { ...current, ...changes, id };
    };
    if (
      studentsRequest.current?.generation === dataGeneration.current &&
      studentsRequest.current?.scope === dataScope
    ) {
      studentsRequest.current.transforms.push(transform);
    }
    const scopedRequest = studentByIdRequests.current.get(id);
    if (
      scopedRequest?.generation === dataGeneration.current &&
      scopedRequest?.scope === dataScope
    ) {
      scopedRequest.transforms.push(scopedTransform);
    }
    const cached = studentsByIdCache.current.get(id);
    if (cached?.value) {
      studentsByIdCache.current.set(id, {
        value: scopedTransform(cached.value),
        fetchedAt: cached.fetchedAt,
      });
    } else if (cached) {
      // A known successful patch means the previous negative cache is stale,
      // but the patch alone is not enough to reconstruct the whole document.
      studentsByIdCache.current.delete(id);
    }
    replaceStudents(transform);
  }, [dataScope, isCurrentDataScope, replaceStudents]);

  const removeStudent = useCallback((id) => {
    if (!isCurrentDataScope()) return;
    const transform = current => current.filter(student => student.id !== id);
    if (
      studentsRequest.current?.generation === dataGeneration.current &&
      studentsRequest.current?.scope === dataScope
    ) {
      studentsRequest.current.transforms.push(transform);
    }
    const scopedRequest = studentByIdRequests.current.get(id);
    if (
      scopedRequest?.generation === dataGeneration.current &&
      scopedRequest?.scope === dataScope
    ) {
      scopedRequest.transforms.push(() => null);
    }
    studentsByIdCache.current.set(id, { value: null, fetchedAt: Date.now() });
    replaceStudents(transform);
  }, [dataScope, isCurrentDataScope, replaceStudents]);

  const upsertPayment = useCallback((payment) => {
    if (!isCurrentDataScope()) return;
    const transform = current => upsertById(current, payment);
    if (
      paymentsRequest.current?.generation === dataGeneration.current &&
      paymentsRequest.current?.scope === dataScope
    ) {
      paymentsRequest.current.transforms.push(transform);
    }
    const studentId = payment?.studentId;
    const scopedRequest = paymentsByStudentRequests.current.get(studentId);
    if (
      scopedRequest?.generation === dataGeneration.current &&
      scopedRequest?.scope === dataScope
    ) {
      scopedRequest.transforms.push(transform);
    }
    const cached = paymentsByStudentCache.current.get(studentId);
    if (cached) {
      paymentsByStudentCache.current.set(studentId, {
        value: transform(cached.value),
        fetchedAt: cached.fetchedAt,
      });
    }
    replacePayments(transform);
  }, [dataScope, isCurrentDataScope, replacePayments]);

  const patchPayment = useCallback((id, changesOrUpdater) => {
    if (!isCurrentDataScope() || !id) return;
    if (
      typeof changesOrUpdater !== 'function' &&
      (!changesOrUpdater || typeof changesOrUpdater !== 'object')
    ) return;

    const transform = current => patchById(current, id, changesOrUpdater);
    if (
      paymentsRequest.current?.generation === dataGeneration.current &&
      paymentsRequest.current?.scope === dataScope
    ) {
      paymentsRequest.current.transforms.push(transform);
    }
    for (const request of paymentsByStudentRequests.current.values()) {
      if (
        request.generation === dataGeneration.current &&
        request.scope === dataScope
      ) {
        request.transforms.push(transform);
      }
    }
    for (const [studentId, cached] of paymentsByStudentCache.current) {
      paymentsByStudentCache.current.set(studentId, {
        value: transform(cached.value),
        fetchedAt: cached.fetchedAt,
      });
    }
    replacePayments(transform);
  }, [dataScope, isCurrentDataScope, replacePayments]);

  const removePayment = useCallback((id) => {
    if (!isCurrentDataScope()) return;
    const transform = current => current.filter(payment => payment.id !== id);
    if (
      paymentsRequest.current?.generation === dataGeneration.current &&
      paymentsRequest.current?.scope === dataScope
    ) {
      paymentsRequest.current.transforms.push(transform);
    }
    for (const request of paymentsByStudentRequests.current.values()) {
      if (
        request.generation === dataGeneration.current &&
        request.scope === dataScope
      ) {
        request.transforms.push(transform);
      }
    }
    for (const [studentId, cached] of paymentsByStudentCache.current) {
      paymentsByStudentCache.current.set(studentId, {
        value: transform(cached.value),
        fetchedAt: cached.fetchedAt,
      });
    }
    replacePayments(transform);
  }, [dataScope, isCurrentDataScope, replacePayments]);

  const loadPastClassDocs = useCallback(async (groupId, { force = false } = {}) => {
    if (!isCurrentDataScope()) {
      throw createCancelledDataRequestError();
    }
    if (pastClassRequests.current.has(groupId)) {
      return pastClassRequests.current.get(groupId);
    }
    const cachedAt = pastClassesLoadedAt.current.get(groupId);
    const cacheIsFresh =
      pastClassesByGroup.current.has(groupId) &&
      cachedAt !== undefined &&
      Date.now() - cachedAt < STAFF_DATA_CACHE_TTL_MS;
    if (!force && cacheIsFresh) {
      return pastClassesByGroup.current.get(groupId);
    }

    const generation = dataGeneration.current;
    const requestScope = dataScope;
    const initialVersion = pastClassVersions.current.get(groupId) || 0;

    const runRequest = version =>
      getDocsFromServer(collection(db, `groups/${groupId}/pastClasses`)).then(snapshot => {
        if (
          dataGeneration.current !== generation ||
          latestDataScope.current !== requestScope
        ) {
          throw createCancelledDataRequestError();
        }

        const currentVersion = pastClassVersions.current.get(groupId) || 0;
        if (currentVersion !== version) {
          // An invalidation happened while this read was in flight. Re-read only
          // after it completes, keeping all callers on the same request chain.
          return runRequest(currentVersion);
        }

        const docs = snapshot.docs.map(item => {
          const data = item.data();
          return { id: item.id, data: () => data };
        });

        if (pastClassRequests.current.get(groupId) === request) {
          pastClassesByGroup.current.set(groupId, docs);
          pastClassesLoadedAt.current.set(groupId, Date.now());
        }
        return docs;
      });

    const request = runRequest(initialVersion)
      .finally(() => {
        if (pastClassRequests.current.get(groupId) === request) {
          pastClassRequests.current.delete(groupId);
        }
      });

    pastClassRequests.current.set(groupId, request);
    return request;
  }, [dataScope, isCurrentDataScope]);

  const updateCachedClass = useCallback((groupId, classId, changes, { remove = false } = {}) => {
    if (!isCurrentDataScope()) return;
    if (pastClassRequests.current.has(groupId)) {
      pastClassVersions.current.set(
        groupId,
        (pastClassVersions.current.get(groupId) || 0) + 1
      );
    }

    const cached = pastClassesByGroup.current.get(groupId);
    if (!cached) return;

    if (remove) {
      pastClassesByGroup.current.set(groupId, cached.filter(item => item.id !== classId));
      return;
    }

    const index = cached.findIndex(item => item.id === classId);
    const currentData = index >= 0 ? cached[index].data() : {};
    const nextData = { ...currentData, ...changes, date: changes.date || currentData.date || classId };
    const nextItem = { id: classId, data: () => nextData };
    const next = [...cached];
    if (index >= 0) next[index] = nextItem;
    else next.push(nextItem);
    pastClassesByGroup.current.set(groupId, next);
  }, [isCurrentDataScope]);

  const invalidatePastClasses = useCallback((groupId) => {
    if (!isCurrentDataScope()) return;
    if (groupId) {
      pastClassVersions.current.set(
        groupId,
        (pastClassVersions.current.get(groupId) || 0) + 1
      );
      pastClassesByGroup.current.delete(groupId);
      pastClassesLoadedAt.current.delete(groupId);
    } else {
      const affectedGroupIds = new Set([
        ...pastClassesByGroup.current.keys(),
        ...pastClassRequests.current.keys(),
      ]);
      for (const affectedGroupId of affectedGroupIds) {
        pastClassVersions.current.set(
          affectedGroupId,
          (pastClassVersions.current.get(affectedGroupId) || 0) + 1
        );
      }
      pastClassesByGroup.current.clear();
      pastClassesLoadedAt.current.clear();
    }
  }, [isCurrentDataScope]);

  const removeGroupFromCachedRecords = useCallback((groupId) => {
    if (!isCurrentDataScope() || !groupId) return;

    const removeGroup = item => {
      if (!Array.isArray(item.groups) || !item.groups.includes(groupId)) return item;
      return { ...item, groups: item.groups.filter(id => id !== groupId) };
    };
    const removeGroupFromItems = current => current.map(removeGroup);

    if (
      studentsRequest.current?.generation === dataGeneration.current &&
      studentsRequest.current?.scope === dataScope
    ) {
      studentsRequest.current.transforms.push(removeGroupFromItems);
    }
    if (
      paymentsRequest.current?.generation === dataGeneration.current &&
      paymentsRequest.current?.scope === dataScope
    ) {
      paymentsRequest.current.transforms.push(removeGroupFromItems);
    }
    for (const request of studentByIdRequests.current.values()) {
      if (
        request.generation === dataGeneration.current &&
        request.scope === dataScope
      ) {
        request.transforms.push(student => student ? removeGroup(student) : student);
      }
    }
    for (const [studentId, cached] of studentsByIdCache.current) {
      studentsByIdCache.current.set(studentId, {
        value: cached.value ? removeGroup(cached.value) : cached.value,
        fetchedAt: cached.fetchedAt,
      });
    }
    for (const request of paymentsByStudentRequests.current.values()) {
      if (
        request.generation === dataGeneration.current &&
        request.scope === dataScope
      ) {
        request.transforms.push(removeGroupFromItems);
      }
    }
    for (const [studentId, cached] of paymentsByStudentCache.current) {
      paymentsByStudentCache.current.set(studentId, {
        value: removeGroupFromItems(cached.value),
        fetchedAt: cached.fetchedAt,
      });
    }

    setGroups(current => current.filter(group => group.id !== groupId));
    replaceStudents(removeGroupFromItems);
    replacePayments(removeGroupFromItems);
    invalidatePastClasses(groupId);
    invalidateReadCache(scheduleCache.current);
    invalidateReadCache(coachTasksCache.current);
    markReadCacheChanged(replacementCache.current);
    for (const key of Array.from(replacementCache.current.keys())) {
      if (key.startsWith(`${groupId}:`)) replacementCache.current.delete(key);
    }
  }, [dataScope, invalidatePastClasses, isCurrentDataScope, replacePayments, replaceStudents]);

  useLayoutEffect(() => {
    if (activeSubscriptionKey.current !== subscriptionKey) {
      activeSubscriptionKey.current = subscriptionKey;
      dataGeneration.current += 1;
      studentsRequest.current = null;
      paymentsRequest.current = null;
      studentsByIdCache.current = new Map();
      studentByIdRequests.current = new Map();
      paymentsByStudentCache.current = new Map();
      paymentsByStudentRequests.current = new Map();
      studentsRef.current = [];
      paymentsRef.current = [];
      studentsLoadedRef.current = false;
      paymentsLoadedRef.current = false;
      studentsLastLoadedAtRef.current = null;
      paymentsLastLoadedAtRef.current = null;
      setGroups([]);
      setProjects([]);
      setWorkshops([]);
      setStudents([]);
      setPayments([]);
      setClasses([]);
      setCoaches([]);
      setGroupsLoaded(false);
      setProjectsLoaded(false);
      setWorkshopsLoaded(false);
      setCoachesLoaded(false);
      setGroupsError(null);
      setProjectsError(null);
      setWorkshopsError(null);
      setCoachesError(null);
      setStudentsLoaded(false);
      setPaymentsLoaded(false);
      setStudentsLoading(false);
      setPaymentsLoading(false);
      setStudentsError(null);
      setPaymentsError(null);
      setStudentsLastLoadedAt(null);
      setPaymentsLastLoadedAt(null);
      // Detach the new user's caches from any async work still holding an old
      // Map reference. Clearing in place would let those old closures refill it.
      pastClassesByGroup.current = new Map();
      pastClassesLoadedAt.current = new Map();
      pastClassRequests.current = new Map();
      pastClassVersions.current = new Map();
      scheduleCache.current = new Map();
      replacementCache.current = new Map();
      coachTasksCache.current = new Map();
    }

    const generation = dataGeneration.current;
    const isCurrentSubscription = () =>
      dataGeneration.current === generation &&
      latestDataScope.current === dataScope;

    if (!user) {
      return undefined;
    }

    const unsubGroups = onSnapshot(
      collection(db, 'groups'),
      snapshot => {
        if (!isCurrentSubscription()) return;
        setGroups(snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
        setGroupsLoaded(true);
        setGroupsError(null);
      },
      error => {
        if (!isCurrentSubscription()) return;
        setGroupsError(error?.message || String(error));
      }
    );

    let unsubStudents;
    let unsubPayments;
    let unsubUsers;
    let unsubProjects;
    let unsubWorkshops;

    if (isStaff) {
      unsubProjects = onSnapshot(
        collection(db, 'projects'),
        snapshot => {
          if (!isCurrentSubscription()) return;
          setProjects(snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
          setProjectsLoaded(true);
          setProjectsError(null);
        },
        error => {
          if (!isCurrentSubscription()) return;
          setProjectsLoaded(true);
          setProjectsError(error?.message || String(error));
        }
      );
      unsubWorkshops = onSnapshot(
        collection(db, 'workshops'),
        snapshot => {
          if (!isCurrentSubscription()) return;
          setWorkshops(snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
          setWorkshopsLoaded(true);
          setWorkshopsError(null);
        },
        error => {
          if (!isCurrentSubscription()) return;
          setWorkshopsLoaded(true);
          setWorkshopsError(error?.message || String(error));
        }
      );
      unsubUsers = onSnapshot(
        query(collection(db, 'users'), where('role', 'in', ['coach', 'admin'])),
        snapshot => {
          if (!isCurrentSubscription()) return;
          setCoaches(snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
          setCoachesLoaded(true);
          setCoachesError(null);
        },
        error => {
          if (!isCurrentSubscription()) return;
          setCoachesError(error?.message || String(error));
        }
      );
    } else {
      setProjects([]);
      setProjectsLoaded(true);
      setProjectsError(null);
      setWorkshops([]);
      setWorkshopsLoaded(true);
      setWorkshopsError(null);
      setCoaches([]);
      setCoachesLoaded(true);
      setCoachesError(null);
      setStudentsLoading(true);
      setPaymentsLoading(true);

      unsubStudents = onSnapshot(
        doc(db, 'students', user.role),
        snapshot => {
          if (!isCurrentSubscription()) return;
          const loadedAt = Date.now();
          const nextStudents = snapshot.exists()
            ? [{ id: snapshot.id, ...snapshot.data() }]
            : [];
          if (
            studentsRequest.current?.generation === generation &&
            studentsRequest.current?.scope === dataScope
          ) {
            studentsRequest.current.transforms.push(() => nextStudents);
          }
          const scopedRequest = studentByIdRequests.current.get(user.role);
          if (
            scopedRequest?.generation === generation &&
            scopedRequest?.scope === dataScope
          ) {
            scopedRequest.transforms.push(() => nextStudents[0] || null);
          }
          studentsByIdCache.current.set(user.role, {
            value: nextStudents[0] || null,
            fetchedAt: loadedAt,
          });
          replaceStudents(nextStudents);
          studentsLoadedRef.current = true;
          studentsLastLoadedAtRef.current = loadedAt;
          setStudentsLoaded(true);
          setStudentsLoading(false);
          setStudentsError(null);
          setStudentsLastLoadedAt(loadedAt);
        },
        error => {
          if (!isCurrentSubscription()) return;
          setStudentsLoading(false);
          setStudentsError(error?.message || String(error));
        }
      );
      unsubPayments = onSnapshot(
        query(collection(db, 'payments'), where('studentId', '==', user.role)),
        snapshot => {
          if (!isCurrentSubscription()) return;
          const loadedAt = Date.now();
          const nextPayments = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
          if (
            paymentsRequest.current?.generation === generation &&
            paymentsRequest.current?.scope === dataScope
          ) {
            paymentsRequest.current.transforms.push(() => nextPayments);
          }
          const scopedRequest = paymentsByStudentRequests.current.get(user.role);
          if (
            scopedRequest?.generation === generation &&
            scopedRequest?.scope === dataScope
          ) {
            scopedRequest.transforms.push(() => nextPayments);
          }
          paymentsByStudentCache.current.set(user.role, {
            value: nextPayments,
            fetchedAt: loadedAt,
          });
          replacePayments(nextPayments);
          paymentsLoadedRef.current = true;
          paymentsLastLoadedAtRef.current = loadedAt;
          setPaymentsLoaded(true);
          setPaymentsLoading(false);
          setPaymentsError(null);
          setPaymentsLastLoadedAt(loadedAt);
        },
        error => {
          if (!isCurrentSubscription()) return;
          setPaymentsLoading(false);
          setPaymentsError(error?.message || String(error));
        }
      );
    }

    return () => {
      unsubGroups();
      unsubStudents?.();
      unsubPayments?.();
      unsubUsers?.();
      unsubProjects?.();
      unsubWorkshops?.();
    };
  // Staff display mode changes do not change the subscribed data set.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataScope, subscriptionKey]);

  useEffect(() => {
    if (!isStaff) return undefined;

    const requirements = staffRouteRequirements(pathname, user?.role);
    if (!requirements.students && !requirements.payments) return undefined;

    const ensureRequiredData = () => {
      if (requirements.students) {
        loadStudentsData().catch(() => {});
      }
      if (requirements.payments) {
        loadPaymentsData().catch(() => {});
      }
    };

    ensureRequiredData();
    window.addEventListener('focus', ensureRequiredData);
    return () => window.removeEventListener('focus', ensureRequiredData);
  }, [isStaff, loadPaymentsData, loadStudentsData, pathname, subscriptionKey, user?.role]);

  return (
    <DataContext.Provider value={{
      groups,
      groupsLoaded,
      groupsError,
      projects,
      projectsLoaded,
      projectsError,
      workshops,
      workshopsLoaded,
      workshopsError,
      students,
      payments,
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
      upsertStudent,
      patchStudent,
      removeStudent,
      upsertPayment,
      patchPayment,
      removePayment,
      removeGroupFromCachedRecords,
      classes,
      db,
      coaches,
      coachesLoaded,
      coachesError,
      pastClassesByGroup: pastClassesByGroup.current,
      loadPastClassDocs,
      updateCachedClass,
      invalidatePastClasses,
      scheduleCache: scheduleCache.current,
      replacementCache: replacementCache.current,
      coachTasksCache: coachTasksCache.current,
    }}>
      {children}
    </DataContext.Provider>
  );
}
