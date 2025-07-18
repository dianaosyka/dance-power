import React, { useEffect, useRef } from 'react';
import { collection, setDoc, doc } from 'firebase/firestore';
import { db } from './context/firebase';

const usersToCreate = [
  { email: 'diana.osyka@outlook.com', role: 'coach' },
];

function generatePassword(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function AppCreateUsers() {
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;

    const createAccounts = async () => {
      console.log('Creating users...');
      for (const user of usersToCreate) {
        const password = "SET PASS";
        const hashedPassword = await hashPassword(password);

        const newDocRef = doc(collection(db, 'users')); // Auto-generated ID
        await setDoc(newDocRef, {
          email: user.email,
          password: hashedPassword,
          role: user.role,
        });

        console.log(`✅ ${user.email} | password: ${password}`);
      }

      alert('✔️ Accounts created. Check console for login credentials.');
    };

    createAccounts();
  }, []);

  return (
    <div style={{ padding: 20, color: 'white' }}>
      Creating accounts... check console for login credentials.
    </div>
  );
}

export default AppCreateUsers;
