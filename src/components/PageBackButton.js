import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import './PageBackButton.css';

const ROUTES_WITHOUT_LOCAL_BACK = [
  /^\/students\/?$/,
  /^\/add-payment\/?$/,
  /^\/payment-history\/?$/,
  /^\/student\/[^/]+\/?$/,
  /^\/group\/[^/]+\/?$/,
  /^\/group\/[^/]+\/class\/[^/]+\/?$/,
];

function PageBackButton() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  if (!ROUTES_WITHOUT_LOCAL_BACK.some(pattern => pattern.test(pathname))) {
    return null;
  }

  const goBack = () => {
    if (/^\/group\/[^/]+\/?$/.test(pathname)) {
      navigate('/groups');
      return;
    }
    const classMatch = pathname.match(/^\/group\/([^/]+)\/class\/[^/]+\/?$/);
    if (classMatch) {
      navigate(`/group/${classMatch[1]}`);
      return;
    }
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate('/groups');
  };

  return (
    <button
      className="page-back-button"
      type="button"
      onClick={goBack}
      aria-label="Go back"
    >
      <span aria-hidden="true">←</span>
    </button>
  );
}

export default PageBackButton;
