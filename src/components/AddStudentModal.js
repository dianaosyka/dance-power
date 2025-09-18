import React, { useState } from 'react';
import { collection, addDoc /* , serverTimestamp */ } from 'firebase/firestore';
import { useData } from '../context/firebase';
import './AddStudentModal.css';

function AddStudentModal({ groupId, onClose }) {
  const { db } = useData();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isSubmitting) return; // block double-clicks

    const nameTrim = name.trim();
    const phoneTrim = phone.trim();

    if (!nameTrim || !phoneTrim) {
      alert('Please fill in name and phone.');
      return;
    }

    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'students'), {
        name: nameTrim,
        phone: phoneTrim,
        groups: groupId ? [groupId] : [],
        // createdAt: serverTimestamp(), // optional if you want
      });

      onClose(); // only close after successful write
    } catch (err) {
      console.error(err);
      alert('❌ Error saving student. Nothing was saved.');
    } finally {
      setIsSubmitting(false);
    }
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
            required
            disabled={isSubmitting}
          />
          <input
            className="modal-input"
            type="tel"
            placeholder="Phone number"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            required
            disabled={isSubmitting}
          />
          <div className="modal-buttons">
            <button
              type="button"
              className="modal-cancel"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="modal-confirm"
              disabled={isSubmitting}
              title={isSubmitting ? 'Saving…' : 'Save'}
            >
              {isSubmitting ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AddStudentModal;