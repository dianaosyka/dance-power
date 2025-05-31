import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import './index.css';
import { DataProvider } from './context/DataContext';
import GroupsPage from './pages/GroupsPage';
import StudentsListPage from './pages/StudentsListPage';
import AddPaymentPage from './pages/AddPaymentPage';
import GroupClassesPage from './pages/GroupClassesPage';


function App() {
  return (
    <DataProvider>
      <Router>
        <Routes>
          <Route path="/" element={<GroupsPage />} />
          <Route path="/students" element={<StudentsListPage />} />
          <Route path="/add-payment" element={<AddPaymentPage />} />
          <Route path="/group/:groupId" element={<GroupClassesPage />} />
        </Routes>
      </Router>
    </DataProvider>
  );
}

export default App;
