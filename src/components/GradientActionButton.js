import React from 'react';
import './GradientActionButton.css';

function GradientActionButton({ icon = '+', wide = false, className = '', children, ...props }) {
  const classes = [
    'gradient-action-button',
    wide ? 'gradient-action-button--wide' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button className={classes} {...props}>
      <span className="gradient-action-button__icon" aria-hidden="true">{icon}</span>
      <span className="gradient-action-button__label">{children}</span>
    </button>
  );
}

export default GradientActionButton;
