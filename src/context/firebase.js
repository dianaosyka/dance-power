import React, { useState, useEffect, createContext, useContext, useCallback, useRef } from 'react';
import {
  getFirestore,
  collection,
  doc,
  onSnapshot,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { initializeApp } from 'firebase/app';
import { useUser } from './UserContext';

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

export function DataProvider({ children }) {
  const { user } = useUser();
  const [groups, setGroups] = useState([]);
  const [students, setStudents] = useState([]);
  const [payments, setPayments] = useState([]);
  const [classes, setClasses] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const pastClassesByGroup = useRef(new Map());
  const pastClassRequests = useRef(new Map());
  const scheduleCache = useRef(new Map());
  const replacementCache = useRef(new Map());
  const coachTasksCache = useRef(new Map());
  const isStaff = user?.role === 'admin' || user?.role === 'coach';
  const subscriptionKey = !user
    ? 'signed-out'
    : isStaff
      ? `${user.id || 'staff'}:staff`
      : `${user.role}:student`;

  const loadPastClassDocs = useCallback(async (groupId, { force = false } = {}) => {
    if (!force && pastClassesByGroup.current.has(groupId)) {
      return pastClassesByGroup.current.get(groupId);
    }
    if (!force && pastClassRequests.current.has(groupId)) {
      return pastClassRequests.current.get(groupId);
    }

    const request = getDocs(collection(db, `groups/${groupId}/pastClasses`))
      .then(snapshot => {
        const docs = snapshot.docs.map(item => {
          const data = item.data();
          return { id: item.id, data: () => data };
        });
        pastClassesByGroup.current.set(groupId, docs);
        return docs;
      })
      .finally(() => pastClassRequests.current.delete(groupId));

    pastClassRequests.current.set(groupId, request);
    return request;
  }, []);

  const updateCachedClass = useCallback((groupId, classId, changes, { remove = false } = {}) => {
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
  }, []);

  const invalidatePastClasses = useCallback((groupId) => {
    if (groupId) pastClassesByGroup.current.delete(groupId);
    else pastClassesByGroup.current.clear();
  }, []);

  useEffect(() => {
    if (!user) {
      setGroups([]);
      setStudents([]);
      setPayments([]);
      setClasses([]);
      setCoaches([]);
      pastClassesByGroup.current.clear();
      pastClassRequests.current.clear();
      scheduleCache.current.clear();
      replacementCache.current.clear();
      coachTasksCache.current.clear();
      return undefined;
    }

    const unsubGroups = onSnapshot(collection(db, 'groups'), snapshot =>
      setGroups(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })))
    );

    let unsubStudents;
    let unsubPayments;
    let unsubUsers;

    if (isStaff) {
      unsubStudents = onSnapshot(collection(db, 'students'), snapshot =>
        setStudents(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })))
      );
      unsubPayments = onSnapshot(collection(db, 'payments'), snapshot =>
        setPayments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })))
      );
      unsubUsers = onSnapshot(
        query(collection(db, 'users'), where('role', 'in', ['coach', 'admin'])),
        snapshot =>
        setCoaches(
          snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
        )
      );
    } else {
      unsubStudents = onSnapshot(doc(db, 'students', user.role), snapshot =>
        setStudents(snapshot.exists() ? [{ id: snapshot.id, ...snapshot.data() }] : [])
      );
      unsubPayments = onSnapshot(
        query(collection(db, 'payments'), where('studentId', '==', user.role)),
        snapshot => setPayments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })))
      );
      setCoaches([]);
      pastClassesByGroup.current.clear();
      pastClassRequests.current.clear();
      scheduleCache.current.clear();
      replacementCache.current.clear();
      coachTasksCache.current.clear();
    }

    return () => {
      unsubGroups();
      unsubStudents?.();
      unsubPayments?.();
      unsubUsers?.();
    };
  // Staff display mode changes do not change the subscribed data set.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscriptionKey]);

  return (
    <DataContext.Provider value={{
      groups,
      students,
      payments,
      classes,
      db,
      coaches,
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
