import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import { DataProvider } from './context/firebase';
import { useUser, UserProvider } from './context/UserContext';

import GroupsPage from './pages/GroupsPage';
import StudentsListPage from './pages/StudentsListPage';
import AddPaymentPage from './pages/AddPaymentPage';
import GroupClassesPage from './pages/GroupClassesPage';
import StudentDetailPage from './pages/StudentDetailPage';
import GroupClassDetailPage from './pages/GroupClassDetailPage';
import LoginPage from './pages/LoginPage';
import PaymentHistoryPage from './pages/PaymentHistoryPage';
import SalaryPage from './pages/SalaryPage';
import SchedulePage from './pages/SchedulePage';
import CreateGroupPage from './pages/CreateGroupPage';
import ProjectsPage from './pages/ProjectsPage';
import ProjectDetailPage from './pages/ProjectDetailPage';
import WorkshopsPage from './pages/WorkshopsPage';
import WorkshopDetailPage from './pages/WorkshopDetailPage';
import CreateWorkshopPage from './pages/CreateWorkshopPage';

function AppRoutes() {
  const { user } = useUser();

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  const isStaff = user.role === 'admin' || user.role === 'coach';

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
      <Route
        path="/add-payment"
        element={user.role === 'admin' || user.role === 'coach'
          ? <AddPaymentPage />
          : <Navigate to="/" replace />}
      />
      <Route path="/group/:groupId" element={<GroupClassesPage />} />
      <Route path="/student/:studentId" element={<StudentDetailPage />} />
      <Route path="/group/:groupId/class/:date" element={<GroupClassDetailPage />} />
      <Route path="/payment-history" element={<PaymentHistoryPage />} />
      <Route path="/salary" element={<SalaryPage />} />
      <Route path="/schedule" element={<SchedulePage />} />
      <Route
        path="/projects"
        element={isStaff ? <ProjectsPage /> : <Navigate to="/" replace />}
      />
      <Route
        path="/project/:projectId"
        element={isStaff ? <ProjectDetailPage /> : <Navigate to="/" replace />}
      />
      <Route
        path="/create-group"
        element={user.role === 'admin'
          ? <CreateGroupPage />
          : <Navigate to="/groups" replace />}
      />
      <Route path="/workshops" element={isStaff ? <WorkshopsPage /> : <Navigate to="/" replace />} />
      <Route path="/workshop/:workshopId" element={isStaff ? <WorkshopDetailPage /> : <Navigate to="/" replace />} />
      <Route path="/create-workshop" element={user.role === 'admin' ? <CreateWorkshopPage /> : <Navigate to="/workshops" replace />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

function App() {
  return (
    <UserProvider>
      <Router>
        <DataProvider>
          <AppRoutes />
        </DataProvider>
      </Router>
    </UserProvider>
  );
}

export default App;
