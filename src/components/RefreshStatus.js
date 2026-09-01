import React from 'react';
import './RefreshStatus.css';

function cleanRefreshMessage(message) {
  if (typeof message !== 'string') return message;

  return message
    .replace(/^Last updated\s*(?:—|:)?\s*/i, '')
    .replace(/^Project updated\s*:\s*/i, '')
    .replace(/^Updated\s*:\s*/i, '')
    .trim();
}

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
  const displayedMessage = cleanRefreshMessage(message || 'Not refreshed yet');

  return (
    <div className={`refresh-status ${error ? 'refresh-status--error' : ''} ${className}`.trim()}>
      {error && (
        <span className="refresh-status__message" role="alert" aria-live="assertive">
          {error}
        </span>
      )}
      {onRefresh && (
        <button
          type="button"
          className="refresh-status__button"
          onClick={onRefresh}
          disabled={disabled || loading}
        >
          <span className="refresh-status__timestamp" role="status" aria-live="polite">
            {displayedMessage}
          </span>
          <span aria-hidden="true" className={loading ? 'refresh-status__icon is-spinning' : 'refresh-status__icon'}>
            ↻
          </span>
          {loading ? loadingLabel : refreshLabel}
        </button>
      )}
      {!onRefresh && !error && (
        <span className="refresh-status__message" role="status" aria-live="polite">
          {displayedMessage}
        </span>
      )}
    </div>
  );
}

export default RefreshStatus;
