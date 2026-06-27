import { useState, useEffect } from 'react';
import { useSettingsStore } from '../store';
import { t, autoSaveConfig } from '../helpers';
import { Toggle } from '../widgets/Toggle';
import { SettingsSection } from '../components/SettingsSection';
import { SettingsRow } from '../components/SettingsRow';
import { useStore } from '../../stores';
import { hanaFetch } from '../../hooks/use-hana-fetch';
import styles from '../Settings.module.css';

interface CustomFolder {
  path: string;
  label: string;
  enabled: boolean;
}

export function DevTab() {
  const showToast = useSettingsStore(s => s.showToast);
  const settingsConfig = useSettingsStore(s => s.settingsConfig);
  const channels = useStore(s => s.channels);
  const agents = useStore(s => s.agents);
  const [customFolders, setCustomFolders] = useState<CustomFolder[]>([]);
  const [newPath, setNewPath] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [globalMemoryConfigs, setGlobalMemoryConfigs] = useState<any[]>([]);
  const [newGmName, setNewGmName] = useState('');
  const [newGmChannel, setNewGmChannel] = useState('');
  const [newGmSourceType, setNewGmSourceType] = useState<'channel' | 'agent' | 'dm' | 'bridge'>('channel');
  const [newGmSourceId, setNewGmSourceId] = useState('');
  const [dms, setDms] = useState<any[]>([]);
  const [bridgeConnections, setBridgeConnections] = useState<any[]>([]);

  useEffect(() => {
    const diarySources = (settingsConfig as any)?.diaryDataSources;
    if (diarySources?.customFolders) {
      setCustomFolders(diarySources.customFolders);
    }
    // Load globalMemory configs from settings
    const gmConfigs = (settingsConfig as any)?.globalMemoryConfigs;
    if (gmConfigs && typeof gmConfigs === 'object') {
      setGlobalMemoryConfigs(Array.isArray(gmConfigs) ? gmConfigs : []);
    }
  }, [settingsConfig]);

  // Fetch DMs and bridge connections
  useEffect(() => {
    const loadDms = async () => {
      try {
        const res = await hanaFetch('/api/dm');
        if (res.ok) {
          const data = await res.json();
          setDms(data.dms || []);
        }
      } catch (err) {
        console.error('[dev] Failed to load DMs:', err);
      }
    };
    const loadBridge = async () => {
      try {
        const res = await hanaFetch('/api/bridge/status');
        if (res.ok) {
          const data = await res.json();
          setBridgeConnections(data.connections || []);
        }
      } catch (err) {
        console.error('[dev] Failed to load bridge status:', err);
      }
    };
    loadDms();
    loadBridge();
  }, []);

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

  // ── Global Memory Config Management ──

  const saveGlobalMemoryConfigs = async (next: any[]) => {
    setSaving(true);
    try {
      // Save to settingsConfig for UI display
      const saved = await autoSaveConfig(
        { globalMemoryConfigs: next },
        { silent: true },
      );
      if (!saved) throw new Error('save returned false');

      // Also update each channel's frontmatter via direct API call
      for (const config of next) {
        if (config.channel) {
          try {
            const res = await hanaFetch(`/api/conversations/${encodeURIComponent(config.channel)}/agent-phone-settings`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                globalMemory: config.enabled,
                globalMemorySources: config.sources || [],
              }),
            });
            if (!res.ok) console.error(`[dev] Failed to update channel ${config.channel}: HTTP ${res.status}`);
          } catch (err) {
            console.error(`[dev] Failed to update channel ${config.channel}:`, err);
          }
        }
      }

      showToast(t('settings.saved'), 'success');
    } catch (err: any) {
      showToast(t('settings.saveFailed') + ': ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const addGlobalMemoryConfig = () => {
    if (!newGmName.trim()) {
      showToast(t('settings.dev.configNameRequired'), 'error');
      return;
    }
    // Build source string based on type
    let source = '';
    if (newGmSourceType === 'channel') {
      source = newGmSourceId ? `ch_${newGmSourceId}` : '';
    } else if (newGmSourceType === 'agent') {
      source = newGmSourceId || '';
    } else if (newGmSourceType === 'dm') {
      source = newGmSourceId ? `dm:${newGmSourceId}` : '';
    } else if (newGmSourceType === 'bridge') {
      source = newGmSourceId || '';
    }
    const sources = source ? [source] : [];
    const next = [
      ...globalMemoryConfigs,
      {
        name: newGmName.trim(),
        channel: newGmChannel.trim() || undefined,
        sources: sources.length > 0 ? sources : undefined,
        enabled: true,
      },
    ];
    setGlobalMemoryConfigs(next);
    setNewGmName('');
    setNewGmChannel('');
    setNewGmSourceId('');
    saveGlobalMemoryConfigs(next);
  };

  const removeGlobalMemoryConfig = async (index: number) => {
    const removed = globalMemoryConfigs[index];
    const next = globalMemoryConfigs.filter((_, i) => i !== index);
    setGlobalMemoryConfigs(next);
    // Clean up channel frontmatter if the removed config had a channel
    if (removed?.channel) {
      try {
        await hanaFetch(`/api/conversations/${encodeURIComponent(removed.channel)}/agent-phone-settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            globalMemory: false,
            globalMemorySources: [],
          }),
        });
      } catch (err) {
        console.error(`[dev] Failed to cleanup channel ${removed.channel}:`, err);
      }
    }
    saveGlobalMemoryConfigs(next);
  };

  const toggleGlobalMemoryConfig = (index: number) => {
    const next = globalMemoryConfigs.map((c, i) =>
      i === index ? { ...c, enabled: !c.enabled } : c
    );
    setGlobalMemoryConfigs(next);
    saveGlobalMemoryConfigs(next);
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

      {/* ── Global Memory Configs ── */}
      <SettingsSection title={t('settings.dev.globalMemory')} description={t('settings.dev.globalMemoryDesc')}>
        {globalMemoryConfigs.length > 0 && globalMemoryConfigs.map((config, index) => (
          <SettingsRow
            key={index}
            label={config.name}
            hint={`${config.channel || '*'}${config.sources ? ` → ${config.sources.join(', ')}` : ''}`}
            control={
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
                <Toggle
                  on={config.enabled}
                  onChange={() => toggleGlobalMemoryConfig(index)}
                />
                <button
                  type="button"
                  className={styles['settings-btn-secondary']}
                  onClick={() => removeGlobalMemoryConfig(index)}
                  title={t('settings.remove')}
                  style={{ padding: '2px 8px', fontSize: '0.85rem' }}
                >
                  ×
                </button>
              </div>
            }
          />
        ))}
        {globalMemoryConfigs.length === 0 && (
          <SettingsRow
            label={t('settings.dev.globalMemoryConfigs')}
            hint={t('settings.dev.noGlobalMemoryConfigs')}
            control={<span />}
          />
        )}
      </SettingsSection>

      <SettingsSection title={t('settings.dev.addGlobalMemory')}>
        <SettingsRow
          label={t('settings.dev.configName')}
          layout="stacked"
          control={
            <input
              className={styles['settings-input']}
              type="text"
              placeholder={t('settings.dev.configNamePlaceholder')}
              value={newGmName}
              onChange={(e) => setNewGmName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addGlobalMemoryConfig(); }}
              style={{ width: '100%' }}
            />
          }
        />
        <SettingsRow
          label={t('settings.dev.targetChannel')}
          layout="stacked"
          control={
            <select
              className={styles['settings-input']}
              value={newGmChannel}
              onChange={(e) => setNewGmChannel(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="">{t('settings.dev.allChannels')}</option>
              {channels.map(ch => (
                <option key={ch.id} value={ch.id}>{ch.name || ch.id}</option>
              ))}
            </select>
          }
        />
        <SettingsRow
          label={t('settings.dev.sourceType') || '来源类型'}
          layout="stacked"
          control={
            <select
              className={styles['settings-input']}
              value={newGmSourceType}
              onChange={(e) => {
                setNewGmSourceType(e.target.value as any);
                setNewGmSourceId('');
              }}
              style={{ width: '100%' }}
            >
              <option value="channel">{t('settings.dev.sourceTypeChannel') || '频道'}</option>
              <option value="agent">{t('settings.dev.sourceTypeAgent') || 'Agent'}</option>
              <option value="dm">{t('settings.dev.sourceTypeDm') || '聊天'}</option>
              <option value="bridge">{t('settings.dev.sourceTypeBridge') || '社交平台'}</option>
            </select>
          }
        />
        <SettingsRow
          label={t('settings.dev.sourceId') || '选择来源'}
          layout="stacked"
          control={
            <select
              className={styles['settings-input']}
              value={newGmSourceId}
              onChange={(e) => setNewGmSourceId(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="">{t('settings.dev.selectSource') || '请选择...'}</option>
              {newGmSourceType === 'channel' && channels.map(ch => (
                <option key={ch.id} value={ch.id}>{ch.name || ch.id}</option>
              ))}
              {newGmSourceType === 'agent' && agents.map(a => (
                <option key={a.id} value={a.id}>{a.name || a.id}</option>
              ))}
              {newGmSourceType === 'dm' && dms.map(dm => (
                <option key={dm.peerId} value={dm.peerId}>{dm.peerName || dm.peerId}</option>
              ))}
              {newGmSourceType === 'bridge' && bridgeConnections.map(conn => (
                <option key={conn.id || conn.platform} value={`${conn.platform}:${conn.chatId || ''}`}>{conn.platform} - {conn.chatId || conn.name || ''}</option>
              ))}
            </select>
          }
        />
        <SettingsSection.Footer>
          <button
            type="button"
            className={styles['settings-btn-primary']}
            onClick={addGlobalMemoryConfig}
            disabled={saving}
          >
            {saving ? t('settings.saving') : t('settings.dev.add')}
          </button>
        </SettingsSection.Footer>
      </SettingsSection>
    </div>
  );
}
