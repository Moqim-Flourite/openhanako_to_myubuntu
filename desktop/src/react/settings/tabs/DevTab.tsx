import { useState, useEffect } from 'react';
import { useSettingsStore } from '../store';
import { hanaFetch } from '../api';
import { t } from '../helpers';
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
  const [newFolder, setNewFolder] = useState({ path: '', label: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const diarySources = (settingsConfig as any)?.diaryDataSources;
    if (diarySources?.customFolders) {
      setCustomFolders(diarySources.customFolders);
    }
  }, [settingsConfig]);

  const saveConfig = async () => {
    setSaving(true);
    try {
      const res = await hanaFetch('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          diaryDataSources: { customFolders },
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      showToast(t('settings.saved'), 'success');
    } catch (err: any) {
      showToast(t('settings.saveFailed') + ': ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const addFolder = () => {
    if (!newFolder.path.trim()) {
      showToast(t('settings.dev.folderPathRequired'), 'error');
      return;
    }
    setCustomFolders([
      ...customFolders,
      { path: newFolder.path.trim(), label: newFolder.label.trim() || newFolder.path.trim(), enabled: true },
    ]);
    setNewFolder({ path: '', label: '' });
  };

  const removeFolder = (index: number) => {
    setCustomFolders(customFolders.filter((_, i) => i !== index));
  };

  const toggleFolder = (index: number) => {
    setCustomFolders(customFolders.map((f, i) =>
      i === index ? { ...f, enabled: !f.enabled } : f
    ));
  };

  return (
    <div className={styles['settings-section']}>
      <h2 className={styles['settings-section-title']}>{t('settings.dev.diaryDataSources')}</h2>
      <p className={styles['settings-section-description']}>
        {t('settings.dev.diaryDataSourcesDesc')}
      </p>

      <div className={styles['settings-form-field']}>
        <label className={styles['settings-label']}>{t('settings.dev.customFolders')}</label>
        {customFolders.length > 0 ? (
          <div className={styles['settings-list']}>
            {customFolders.map((folder, index) => (
              <div key={index} className={styles['settings-list-item']}>
                <div className={styles['settings-list-item-content']}>
                  <span className={styles['settings-list-item-title']}>{folder.label}</span>
                  <span className={styles['settings-list-item-subtitle']}>{folder.path}</span>
                </div>
                <div className={styles['settings-list-item-actions']}>
                  <button
                    type="button"
                    className={styles['settings-toggle-btn']}
                    onClick={() => toggleFolder(index)}
                    title={folder.enabled ? t('settings.disable') : t('settings.enable')}
                  >
                    {folder.enabled ? '✓' : '✗'}
                  </button>
                  <button
                    type="button"
                    className={styles['settings-remove-btn']}
                    onClick={() => removeFolder(index)}
                    title={t('settings.remove')}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className={styles['settings-empty-text']}>{t('settings.dev.noCustomFolders')}</p>
        )}
      </div>

      <div className={styles['settings-form-field']}>
        <label className={styles['settings-label']}>{t('settings.dev.addFolder')}</label>
        <div className={styles['settings-input-group']}>
          <input
            className={styles['settings-input']}
            type="text"
            placeholder={t('settings.dev.folderPathPlaceholder')}
            value={newFolder.path}
            onChange={(e) => setNewFolder({ ...newFolder, path: e.target.value })}
          />
          <input
            className={styles['settings-input']}
            type="text"
            placeholder={t('settings.dev.folderLabelPlaceholder')}
            value={newFolder.label}
            onChange={(e) => setNewFolder({ ...newFolder, label: e.target.value })}
          />
          <button
            type="button"
            className={styles['settings-btn']}
            onClick={addFolder}
          >
            {t('settings.dev.add')}
          </button>
        </div>
      </div>

      <div className={styles['settings-form-field']}>
        <button
          type="button"
          className={styles['settings-primary-btn']}
          onClick={saveConfig}
          disabled={saving}
        >
          {saving ? t('settings.saving') : t('settings.save')}
        </button>
      </div>
    </div>
  );
}
