import React, { useState, useEffect } from 'react';
import { useSettingsStore, type ProviderSummary } from '../../store';
import { hanaFetch } from '../../api';
import { t, API_FORMAT_OPTIONS } from '../../helpers';
import { SelectWidget } from '../../widgets/SelectWidget';
import { KeyInput } from '../../widgets/KeyInput';
import styles from '../../Settings.module.css';

const platform = window.platform;

function maskKeyForLog(key: string) {
  if (!key) return { masked: '', len: 0 };
  const trimmed = String(key).trim();
  if (!trimmed) return { masked: '', len: 0 };
  if (trimmed.length <= 10) return { masked: `${trimmed.slice(0, 2)}...${trimmed.slice(-2)}`, len: trimmed.length };
  return { masked: `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`, len: trimmed.length };
}

function logApiConfigUi(event: string, payload: Record<string, unknown> = {}) {
  try {
    console.log('[api-config/ui]', event, payload);
  } catch {}
}

export function ApiKeyCredentials({ providerId, summary, providerConfig, isPresetSetup, presetInfo, onRefresh }: {
  providerId: string;
  summary: ProviderSummary;
  providerConfig?: Record<string, unknown>;
  isPresetSetup?: boolean;
  presetInfo?: { label: string; value: string; url?: string; api?: string; local?: boolean };
  onRefresh: () => Promise<void>;
}) {
  const { showToast } = useSettingsStore();
  const [keyVal, setKeyVal] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [showMaskedValue, setShowMaskedValue] = useState(true);
  const baseUrl = summary.base_url || presetInfo?.url || '';
  const api = summary.api || presetInfo?.api || '';

  useEffect(() => {
    if (!keyEdited) {
      logApiConfigUi('summary-sync', {
        providerId,
        hasMaskedKey: !!summary.api_key_masked,
        maskedKey: summary.api_key_masked || '',
        keyEdited,
      });
      setKeyVal('');
      setHasStoredKey(!!summary.api_key_masked);
      setShowMaskedValue(true);
    }
  }, [providerId, summary.api_key_masked, keyEdited]);

  const effectiveApiKey = keyEdited ? keyVal.trim() : '';
  const shouldUseStoredKey = !keyEdited && hasStoredKey;
  const displayValue = !keyEdited && showMaskedValue && hasStoredKey ? (summary.api_key_masked || '') : keyVal;

  const verifyAndSave = async (btn: HTMLButtonElement) => {
    if (!keyEdited) return;
    const key = effectiveApiKey;
    if (!key && !presetInfo?.local) return;
    btn.classList.add(styles['spinning']);
    try {
      logApiConfigUi('verify-and-save:start', {
        providerId,
        isPresetSetup: !!isPresetSetup,
        baseUrl,
        api,
        keyEdited,
        hasStoredKey,
        shouldUseStoredKey,
        displayValue,
        key: maskKeyForLog(key),
      });
      const testRes = await hanaFetch('/api/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: providerId, base_url: baseUrl, api, api_key: key }),
      });
      const testData = await testRes.json();
      logApiConfigUi('verify-and-save:test-result', {
        providerId,
        ok: !!testData.ok,
        error: testData.error || '',
      });
      if (!testData.ok) {
        showToast(t('settings.providers.verifyFailed'), 'error');
        return;
      }
      const payload = isPresetSetup
        ? { base_url: baseUrl, api_key: key, api, models: [] as string[] }
        : { api_key: key };
      logApiConfigUi('verify-and-save:save-payload', {
        providerId,
        payload: {
          ...payload,
          api_key: maskKeyForLog(String(payload.api_key || '')),
        },
      });
      await hanaFetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providers: { [providerId]: payload } }),
      });
      showToast(t('settings.providers.verifySuccess'), 'success');
      if (isPresetSetup) useSettingsStore.setState({ selectedProviderId: providerId });
      setKeyEdited(false);
      setKeyVal('');
      setShowMaskedValue(true);
      await onRefresh();
      platform?.settingsChanged?.('models-changed');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(t('settings.saveFailed') + ': ' + msg, 'error');
    } finally {
      btn.classList.remove(styles['spinning']);
    }
  };

  const [connStatus, setConnStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');

  const verifyOnly = async (btn: HTMLButtonElement) => {
    setConnStatus('testing');
    btn.classList.add(styles['spinning']);
    try {
      const payload: Record<string, unknown> = { name: providerId, base_url: baseUrl, api };
      if (keyEdited) {
        payload.api_key = effectiveApiKey || undefined;
      } else if (!shouldUseStoredKey && !presetInfo?.local) {
        payload.api_key = undefined;
      }
      const testRes = await hanaFetch('/api/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const testData = await testRes.json();
      setConnStatus(testData.ok ? 'ok' : 'fail');
      showToast(testData.ok ? t('settings.providers.verifySuccess') : t('settings.providers.verifyFailed'), testData.ok ? 'success' : 'error');
    } catch {
      setConnStatus('fail');
      showToast(t('settings.providers.verifyFailed'), 'error');
    } finally {
      btn.classList.remove(styles['spinning']);
    }
  };

  return (
    <div className={styles['pv-credentials']}>
      <div className={styles['pv-cred-row']}>
        <span className={styles['pv-cred-label']}>{t('settings.api.apiKey')}</span>
        <div className={styles['pv-cred-key-row']}>
          <KeyInput
            value={keyVal}
            displayValue={displayValue}
            onFocus={() => {
              logApiConfigUi('input-focus', {
                providerId,
                keyEdited,
                hasStoredKey,
                showMaskedValue,
                displayValue,
              });
              if (!keyEdited && hasStoredKey) {
                setShowMaskedValue(false);
              }
            }}
            onChange={(v) => {
              logApiConfigUi('input-change', {
                providerId,
                incomingValue: maskKeyForLog(v),
                keyEditedBefore: keyEdited,
                hasStoredKeyBefore: hasStoredKey,
                displayValueBefore: displayValue,
              });
              if (!keyEdited) {
                setKeyEdited(true);
                setShowMaskedValue(false);
                setKeyVal('');
              }
              setKeyVal(v);
              setHasStoredKey(false);
              setConnStatus('idle');
            }}
            onBlur={() => {
              if (!keyEdited) {
                setShowMaskedValue(true);
              }
            }}
            placeholder={keyEdited ? (isPresetSetup ? t('settings.providers.setupHint') : '') : (hasStoredKey ? '' : (isPresetSetup ? t('settings.providers.setupHint') : ''))}
          />
          <button
            className={`${styles['pv-cred-conn-icon']} ${styles[connStatus] || ''}`}
            title={t('settings.providers.verifyConnection')}
            onClick={(e) => {
              if (keyEdited && (effectiveApiKey || presetInfo?.local)) {
                verifyAndSave(e.currentTarget);
              } else {
                verifyOnly(e.currentTarget);
              }
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </button>
        </div>
      </div>
      <div className={styles['pv-cred-row']}>
        <span className={styles['pv-cred-label']}>Base URL</span>
        <span className={`${styles['pv-cred-value']} ${styles['muted']}`}>{baseUrl || '\u2014'}</span>
      </div>
      <div className={styles['pv-cred-row']}>
        <span className={styles['pv-cred-label']}>{t('settings.providers.apiType')}</span>
        <div className={styles['pv-cred-select-wrapper']}>
          <SelectWidget
            options={API_FORMAT_OPTIONS}
            value={api || ''}
            onChange={async (val) => {
              if (isPresetSetup) return;
              try {
                await hanaFetch('/api/config', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ providers: { [providerId]: { api: val } } }),
                });
                showToast(t('settings.saved'), 'success');
                await onRefresh();
              } catch { /* swallow */ }
            }}
            placeholder="API Format"
          />
        </div>
      </div>
    </div>
  );
}
