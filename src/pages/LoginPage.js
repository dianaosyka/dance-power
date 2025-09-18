import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import { getDoc, doc, collection, getDocs } from 'firebase/firestore';
import { useData } from '../context/firebase';
import './LoginPage.css';

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function LoginPage() {
  const { setUser } = useUser();
  const { db } = useData();
  const navigate = useNavigate();

  const [mode, setMode] = useState(null); // null | 'admin' | 'student'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [studentId, setStudentId] = useState('');

  const handleLogin = async () => {
    if (!email || !password) {
      alert('Please enter email and password');
      return;
    }

    try {
      const hashed = await hashPassword(password);
      const usersRef = collection(db, 'users');
      const snapshot = await getDocs(usersRef);
      const match = snapshot.docs.find(doc => {
        const data = doc.data();
        return data.email === email && data.password === hashed;
      });

      if (!match) {
        alert('❌ Invalid credentials');
        return;
      }

      const userData = match.data();
      setUser({
        id: match.id,
        email: userData.email,
        role: userData.role,
        groups: userData.groups || [],
      });

      navigate('/');
    } catch (err) {
      console.error(err);
      alert('❌ Error logging in');
    }
  };

  const handleStudentLogin = async () => {
    if (!studentId) {
      alert('Please enter your student ID');
      return;
    }

    try {
      const studentRef = doc(db, 'students', studentId);
      const snap = await getDoc(studentRef);

      if (!snap.exists()) {
        alert('❌ Invalid student ID');
        return;
      }

      setUser({ role: studentId });
      navigate('/');
    } catch (err) {
      console.error(err);
      alert('❌ Error verifying student ID');
    }
  };

  return (
    <div className="login-page">
      <h2 className="login-title">Login</h2>

      {!mode && (
        <div className="button-group">
          <button onClick={() => setMode('admin')}>
            👩‍🏫 I'm a Teacher
          </button>
          <button onClick={() => setMode('student')}>🎓 I'm a Student</button>
        </div>
      )}

      {mode === 'admin' && (
        <>
          <div className="form-row">
            <label>Email:</label>
            <input className="input" value={email} onChange={e => setEmail(e.target.value)} />
          </div>

          <div className="form-row">
            <label>Password:</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </div>

          <button className="confirm-button" onClick={handleLogin}>
            Login
          </button>

          <div style={{ marginTop: '20px', textAlign: 'center' }}>
            <button onClick={() => setMode(null)}>⬅ Back</button>
          </div>
        </>
      )}

      {mode === 'student' && (
        <>
          <div className="form-row">
            <label>Student ID:</label>
            <input
              className="input"
              value={studentId}
              onChange={e => setStudentId(e.target.value)}
            />
          </div>

          <button onClick={handleStudentLogin}>🔍 Search</button>

          <div style={{ marginTop: '20px', textAlign: 'center' }}>
            <button onClick={() => setMode(null)}>⬅ Back</button>
          </div>
        </>
      )}
    </div>
  );
}

export default LoginPage;
