import React, { useState, useEffect, createContext, useContext } from 'react';
import {
  getFirestore,
  collection,
  doc,
  onSnapshot,
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

  useEffect(() => {
    if (!user) {
      setGroups([]);
      setStudents([]);
      setPayments([]);
      setClasses([]);
      setCoaches([]);
      return undefined;
    }

    const isStaff = user.role === 'admin' || user.role === 'coach';

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
      unsubUsers = onSnapshot(collection(db, 'users'), snapshot =>
        setCoaches(
          snapshot.docs
            .map(doc => ({ id: doc.id, ...doc.data() }))
            .filter(user => user.role === "coach" || user.role === "admin")
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
    }

    return () => {
      unsubGroups();
      unsubStudents?.();
      unsubPayments?.();
      unsubUsers?.();
    };
  }, [user]);

  return (
    <DataContext.Provider value={{ groups, students, payments, classes, db, coaches }}>
      {children}
    </DataContext.Provider>
  );
}
