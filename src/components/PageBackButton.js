import React from 'react';
import { useLocation } from 'react-router-dom';
import { useAppBack } from './AppNavigationHistory';
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
  const goBack = useAppBack();
  const { pathname } = useLocation();

  if (!ROUTES_WITHOUT_LOCAL_BACK.some(pattern => pattern.test(pathname))) {
    return null;
  }

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
