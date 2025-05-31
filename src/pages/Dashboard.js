import React from 'react';
import AddGroupForm from '../components/AddGroupForm';
import GroupList from '../components/GroupList';
import AddStudentForm from '../components/AddStudentForm';
import StudentList from '../components/StudentList';
import PaymentOverview from '../components/PaymentOverview';
import ClassList from '../components/ClassList';

function Dashboard() {
  return (
    <div className="p-4 text-white space-y-6">
      <h1 className="text-3xl font-bold">Dance Payments App</h1>
      <AddGroupForm />
      <GroupList />
      <AddStudentForm />
      <StudentList />
      <ClassList />
      <PaymentOverview />
    </div>
  );
}

export default Dashboard;
