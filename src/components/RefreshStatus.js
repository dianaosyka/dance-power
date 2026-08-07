import React from 'react';
import './RefreshStatus.css';

function RefreshStatus({
  message,
  error,
  loading = false,
  onRefresh,
  disabled = false,
  refreshLabel = 'Refresh',
  loadingLabel = 'Refreshing…',
  className = '',
}) {
  const displayedMessage = error || message || 'Not refreshed yet';

  return (
    <div className={`refresh-status ${error ? 'refresh-status--error' : ''} ${className}`.trim()}>
      <span
        className="refresh-status__message"
        role={error ? 'alert' : 'status'}
        aria-live={error ? 'assertive' : 'polite'}
      >
        {displayedMessage}
      </span>
      {onRefresh && (
        <button
          type="button"
          className="refresh-status__button"
          onClick={onRefresh}
          disabled={disabled || loading}
        >
          <span aria-hidden="true" className={loading ? 'refresh-status__icon is-spinning' : 'refresh-status__icon'}>
            ↻
          </span>
          {loading ? loadingLabel : refreshLabel}
        </button>
      )}
    </div>
  );
}

export default RefreshStatus;
