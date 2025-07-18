import React, { useState } from 'react';
import { collection, addDoc } from 'firebase/firestore';
import { useData } from '../context/firebase';
import './AddStudentModal.css';

function AddStudentModal({ groupId, onClose }) {
  const { db } = useData();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name || !phone) return;
    await addDoc(collection(db, 'students'), {
      name,
      phone,
      groups: groupId ? [groupId] : [],
    });
    onClose();
  };

  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <h3 className="modal-title">Add Student</h3>
        <form onSubmit={handleSubmit}>
          <input
            className="modal-input"
            type="text"
            placeholder="Full name"
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <input
            className="modal-input"
            type="tel"
            placeholder="Phone number"
            value={phone}
            onChange={e => setPhone(e.target.value)}
          />
          <div className="modal-buttons">
            <button type="button" className="modal-cancel" onClick={onClose}>Cancel</button>
            <button type="submit" className="modal-confirm">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AddStudentModal;
