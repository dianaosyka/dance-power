import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import './index.css';
import { DataProvider } from './context/DataContext';
import GroupsPage from './pages/GroupsPage';
import StudentsListPage from './pages/StudentsListPage';
import AddPaymentPage from './pages/AddPaymentPage';
import GroupClassesPage from './pages/GroupClassesPage';
import StudentDetailPage from './pages/StudentDetailPage';
import GroupClassDetailPage from './pages/GroupClassDetailPage';



function App() {
  return (
    <DataProvider>
      <Router>
        <Routes>
          <Route path="/" element={<GroupsPage />} />
          <Route path="/students" element={<StudentsListPage />} />
          <Route path="/add-payment" element={<AddPaymentPage />} />
          <Route path="/group/:groupId" element={<GroupClassesPage />} />
          <Route path="/student/:studentId" element={<StudentDetailPage />} />
          <Route path="/group/:groupId/class/:date" element={<GroupClassDetailPage />} />
        </Routes>
      </Router>
    </DataProvider>
  );
}

export default App;
