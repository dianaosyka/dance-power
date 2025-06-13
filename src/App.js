import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import { DataProvider } from './context/DataContext';
import { useUser, UserProvider } from './context/UserContext';

import GroupsPage from './pages/GroupsPage';
import StudentsListPage from './pages/StudentsListPage';
import AddPaymentPage from './pages/AddPaymentPage';
import GroupClassesPage from './pages/GroupClassesPage';
import StudentDetailPage from './pages/StudentDetailPage';
import GroupClassDetailPage from './pages/GroupClassDetailPage';
import LoginPage from './pages/LoginPage';
import PaymentHistoryPage from './pages/PaymentHistoryPage';


function AppRoutes() {
  const { user } = useUser();

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route
        path="/"
        element={
          user.role === 'admin' || user.role === 'coach'
            ? <Navigate to="/groups" replace />
            : <Navigate to={`/student/${user.role}`} replace />
        }
      />
      <Route path="/groups" element={<GroupsPage />} />
      <Route path="/students" element={<StudentsListPage />} />
      <Route path="/add-payment" element={<AddPaymentPage />} />
      <Route path="/group/:groupId" element={<GroupClassesPage />} />
      <Route path="/student/:studentId" element={<StudentDetailPage />} />
      <Route path="/group/:groupId/class/:date" element={<GroupClassDetailPage />} />
      <Route path="/payment-history" element={<PaymentHistoryPage />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

function App() {
  return (
    <UserProvider>
      <DataProvider>
        <Router>
          <AppRoutes />
        </Router>
      </DataProvider>
    </UserProvider>
  );
}

export default App;
