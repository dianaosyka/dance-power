import React, { useRef, useState } from 'react';
import { collection, addDoc /* , serverTimestamp */ } from 'firebase/firestore';
import { useData } from '../context/firebase';
import './AddStudentModal.css';

function AddStudentModal({ onClose }) {
  const { db, upsertStudent } = useData();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionInProgress = useRef(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submissionInProgress.current) return;

    const nameTrim = name.trim();
    const phoneTrim = phone.trim();

    if (!nameTrim || !phoneTrim) {
      alert('Please fill in name and phone.');
      return;
    }

    submissionInProgress.current = true;
    setIsSubmitting(true);
    try {
      const studentData = {
        name: nameTrim,
        phone: phoneTrim,
        // Group enrollment is managed explicitly from Group details.
        groups: [],
        // createdAt: serverTimestamp(), // optional if you want
      };
      const studentRef = await addDoc(collection(db, 'students'), studentData);
      upsertStudent({ id: studentRef.id, ...studentData });

      onClose(); // only close after successful write
    } catch (err) {
      console.error(err);
      alert('❌ Error saving student. Nothing was saved.');
    } finally {
      submissionInProgress.current = false;
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
