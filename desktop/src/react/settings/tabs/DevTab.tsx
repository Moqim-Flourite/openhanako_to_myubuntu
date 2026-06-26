import { useState, useEffect } from 'react';
import { useSettingsStore } from '../store';
import { t, autoSaveConfig } from '../helpers';
import { Toggle } from '../widgets/Toggle';
import { SettingsSection } from '../components/SettingsSection';
import { SettingsRow } from '../components/SettingsRow';
import styles from '../Settings.module.css';

interface CustomFolder {
  path: string;
  label: string;
  enabled: boolean;
}

export function DevTab() {
  const showToast = useSettingsStore(s => s.showToast);
  const settingsConfig = useSettingsStore(s => s.settingsConfig);
  const [customFolders, setCustomFolders] = useState<CustomFolder[]>([]);
  const [newPath, setNewPath] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const diarySources = (settingsConfig as any)?.diaryDataSources;
    if (diarySources?.customFolders) {
      setCustomFolders(diarySources.customFolders);
    }
  }, [settingsConfig]);

  const saveFolders = async (next: CustomFolder[]) => {
    setSaving(true);
    try {
      const saved = await autoSaveConfig(
        { diaryDataSources: { customFolders: next } },
        { silent: true },
      );
      if (!saved) throw new Error('save returned false');
      showToast(t('settings.saved'), 'success');
    } catch (err: any) {
      showToast(t('settings.saveFailed') + ': ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const addFolder = () => {
    if (!newPath.trim()) {
      showToast(t('settings.dev.folderPathRequired'), 'error');
      return;
    }
    const next = [
      ...customFolders,
      { path: newPath.trim(), label: newLabel.trim() || newPath.trim(), enabled: true },
    ];
    setCustomFolders(next);
    setNewPath('');
    setNewLabel('');
    saveFolders(next);
  };

  const removeFolder = (index: number) => {
    const next = customFolders.filter((_, i) => i !== index);
    setCustomFolders(next);
    saveFolders(next);
  };

  const toggleFolder = (index: number) => {
    const next = customFolders.map((f, i) =>
      i === index ? { ...f, enabled: !f.enabled } : f
    );
    setCustomFolders(next);
    saveFolders(next);
  };

  return (
    <div className={`${styles['settings-tab-content']} ${styles['active']}`} data-tab="dev">
      <SettingsSection title={t('settings.dev.diaryDataSources')} description={t('settings.dev.diaryDataSourcesDesc')}>
        {customFolders.length > 0 && customFolders.map((folder, index) => (
          <SettingsRow
            key={index}
            label={folder.label}
            hint={folder.path}
            control={
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
                <Toggle
                  on={folder.enabled}
                  onChange={() => toggleFolder(index)}
                />
                <button
                  type="button"
                  className={styles['settings-btn-secondary']}
                  onClick={() => removeFolder(index)}
                  title={t('settings.remove')}
                  style={{ padding: '2px 8px', fontSize: '0.85rem' }}
                >
                  ×
                </button>
              </div>
            }
          />
        ))}
        {customFolders.length === 0 && (
          <SettingsRow
            label={t('settings.dev.customFolders')}
            hint={t('settings.dev.noCustomFolders')}
            control={<span />}
          />
        )}
      </SettingsSection>

      <SettingsSection title={t('settings.dev.addFolder')}>
        <SettingsRow
          label={t('settings.dev.folderPathPlaceholder')}
          layout="stacked"
          control={
            <input
              className={styles['settings-input']}
              type="text"
              placeholder={t('settings.dev.folderPathPlaceholder')}
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addFolder(); }}
              style={{ width: '100%' }}
            />
          }
        />
        <SettingsRow
          label={t('settings.dev.folderLabelPlaceholder')}
          layout="stacked"
          control={
            <input
              className={styles['settings-input']}
              type="text"
              placeholder={t('settings.dev.folderLabelPlaceholder')}
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addFolder(); }}
              style={{ width: '100%' }}
            />
          }
        />
        <SettingsSection.Footer>
          <button
            type="button"
            className={styles['settings-btn-primary']}
            onClick={addFolder}
            disabled={saving}
          >
            {saving ? t('settings.saving') : t('settings.dev.add')}
          </button>
        </SettingsSection.Footer>
      </SettingsSection>
    </div>
  );
}
