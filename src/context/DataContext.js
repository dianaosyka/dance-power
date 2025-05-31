import React, { useState, useEffect, createContext, useContext } from 'react';
import {
  getFirestore,
  collection,
  onSnapshot,
} from 'firebase/firestore';
import { initializeApp } from 'firebase/app';

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
const db = getFirestore(app);

const DataContext = createContext();
export const useData = () => useContext(DataContext);

export function DataProvider({ children }) {
  const [groups, setGroups] = useState([]);
  const [students, setStudents] = useState([]);
  const [payments, setPayments] = useState([]);
  const [classes, setClasses] = useState([]);

  useEffect(() => {
    const unsubGroups = onSnapshot(collection(db, 'groups'), snapshot =>
      setGroups(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })))
    );
    const unsubStudents = onSnapshot(collection(db, 'students'), snapshot =>
      setStudents(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })))
    );
    const unsubPayments = onSnapshot(collection(db, 'payments'), snapshot =>
      setPayments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })))
    );
    const unsubClasses = onSnapshot(collection(db, 'classes'), snapshot =>
      setClasses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })))
    );

    return () => {
      unsubGroups();
      unsubStudents();
      unsubPayments();
      unsubClasses();
    };
  }, []);

  return (
    <DataContext.Provider value={{ groups, students, payments, classes, db }}>
      {children}
    </DataContext.Provider>
  );
}
