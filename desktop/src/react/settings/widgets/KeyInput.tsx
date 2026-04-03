/**
 * API Key 输入框 — password/text 切换
 */
import React, { useState } from 'react';
import styles from '../Settings.module.css';

interface KeyInputProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  onBlur?: () => void;
  displayValue?: string;
  onFocus?: () => void;
}

export function KeyInput({ value, onChange, placeholder, onBlur, displayValue, onFocus }: KeyInputProps) {
  const t = window.t || ((k: string) => k);
  const [visible, setVisible] = useState(false);
  const showMaskedOverlay = typeof displayValue === 'string' && displayValue.length > 0 && !value;
  const inputValue = value;

  return (
    <div className={styles['settings-key-wrapper']} style={{ position: 'relative' }}>
      <input
        className={`${styles['settings-input']} ${styles['settings-key-input']}`}
        type={visible ? 'text' : 'password'}
        value={inputValue}
        onChange={(e) => onChange(e.target.value)}
        placeholder={showMaskedOverlay ? '' : placeholder}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      {showMaskedOverlay && (
        <div
          style={{
            position: 'absolute',
            left: '12px',
            right: '88px',
            top: '50%',
            transform: 'translateY(-50%)',
            pointerEvents: 'none',
            color: 'var(--text-muted)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {displayValue}
        </div>
      )}
      <button
        className={styles['settings-key-toggle']}
        type="button"
        onClick={() => setVisible(!visible)}
      >
        {visible ? t('settings.api.hideKey') : t('settings.api.showKey')}
      </button>
    </div>
  );
}
