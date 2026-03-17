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

// import React, { useState } from "react";
// import { collection, getDocs } from "firebase/firestore";
// import { db } from "./context/firebase";
// import * as XLSX from "xlsx";

// function normalizeValue(v) {
//   if (v == null) return "";

//   if (typeof v === "object" && typeof v.toDate === "function")
//     return v.toDate().toISOString();

//   if (Array.isArray(v)) return JSON.stringify(v);

//   if (typeof v === "object") return JSON.stringify(v);

//   return v;
// }

// function normalizeDoc(id, data) {
//   const out = { id };
//   for (const [k, v] of Object.entries(data || {})) {
//     out[k] = normalizeValue(v);
//   }
//   return out;
// }

// async function fetchCollection(name) {
//   const snap = await getDocs(collection(db, name));
//   return snap.docs.map(d => normalizeDoc(d.id, d.data()));
// }

// function sheetFromJson(wb, sheetName, rows) {
//   const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ empty: "" }]);
//   XLSX.utils.book_append_sheet(wb, ws, sheetName);
// }

// export default function App() {
//   const [status, setStatus] = useState("Idle");
//   const [running, setRunning] = useState(false);

//   const exportAll = async () => {
//     if (running) return;

//     setRunning(true);
//     setStatus("Exporting...");

//     try {
//       const wb = XLSX.utils.book_new();

//       const TOP_LEVEL = ["students", "payments", "groups", "users"];

//       // 1️⃣ Top-level collections
//       for (const col of TOP_LEVEL) {
//         setStatus(`Reading ${col}...`);
//         const rows = await fetchCollection(col);
//         sheetFromJson(wb, col.slice(0, 31), rows);
//       }

//       // 2️⃣ groups/{groupId}/pastClasses
//       setStatus("Reading groups/*/pastClasses...");
//       const groupsRows = await fetchCollection("groups");
//       const pastClassesRows = [];

//       for (const g of groupsRows) {
//         const groupId = g.id;
//         const snap = await getDocs(
//           collection(db, `groups/${groupId}/pastClasses`)
//         );

//         for (const d of snap.docs) {
//           pastClassesRows.push({
//             groupId,
//             pastClassId: d.id,
//             ...normalizeDoc(d.id, d.data()),
//           });
//         }
//       }

//       sheetFromJson(wb, "group_pastClasses", pastClassesRows);

//       // 3️⃣ Download Excel
//       setStatus("Writing Excel file...");
//       XLSX.writeFile(
//         wb,
//         `firestore_export_${new Date().toISOString().slice(0, 10)}.xlsx`
//       );

//       setStatus("✅ Done! File downloaded.");
//     } catch (e) {
//       console.error(e);
//       setStatus("❌ Export failed. Check console.");
//     } finally {
//       setRunning(false);
//     }
//   };

//   return (
//     <div style={{ padding: 20, fontFamily: "sans-serif" }}>
//       <h2>Firestore → Excel Export (one-time)</h2>
//       <p>Status: <b>{status}</b></p>

//       <button
//         onClick={exportAll}
//         disabled={running}
//         style={{ padding: "10px 14px", fontSize: 16 }}
//       >
//         {running ? "Exporting..." : "Export to Excel"}
//       </button>

//       <p style={{ marginTop: 12, opacity: 0.8 }}>
//         After exporting, restore your original App.js.
//       </p>
//     </div>
//   );
// }