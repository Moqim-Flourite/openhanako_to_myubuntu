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
  const [newGmChannels, setNewGmChannels] = useState<string[]>([]);
  const [newGmAgents, setNewGmAgents] = useState<string[]>([]);
  const [newGmSessions, setNewGmSessions] = useState<string[]>([]);
  const [newGmBridgePlatform, setNewGmBridgePlatform] = useState('');
  const [newGmBridgeChats, setNewGmBridgeChats] = useState<string[]>([]);
  const [chatSessions, setChatSessions] = useState<any[]>([]);
  const [bridgeSessions, setBridgeSessions] = useState<any[]>([]);
  const bridgePlatforms = [...new Set(bridgeSessions.map((s: any) => s.platform))];

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

  // Fetch chat sessions and bridge sessions
  useEffect(() => {
    const loadSessions = async () => {
      try {
        const res = await hanaFetch('/api/sessions');
        if (res.ok) {
          const data = await res.json();
          setChatSessions(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        console.error('[dev] Failed to load sessions:', err);
      }
    };
    const loadBridge = async () => {
      try {
        const res = await hanaFetch('/api/bridge/sessions');
        if (res.ok) {
          const data = await res.json();
          setBridgeSessions(data.sessions || []);
        }
      } catch (err) {
        console.error('[dev] Failed to load bridge sessions:', err);
      }
    };
    loadSessions();
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

      // Update each selected channel's frontmatter
      for (const config of next) {
        const channelSources = (config.sources || []).filter((s: string) => s.startsWith('ch_'));
        for (const src of channelSources) {
          const channelId = src.replace('ch_', '');
          try {
            const res = await hanaFetch(`/api/conversations/${encodeURIComponent(channelId)}/agent-phone-settings`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                globalMemory: config.enabled,
                globalMemorySources: config.sources || [],
              }),
            });
            if (!res.ok) console.error(`[dev] Failed to update channel ${channelId}: HTTP ${res.status}`);
          } catch (err) {
            console.error(`[dev] Failed to update channel ${channelId}:`, err);
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
    // Build sources from all four multi-select values
    const sources: string[] = [];
    newGmChannels.forEach(ch => sources.push(`ch_${ch}`));
    newGmAgents.forEach(a => sources.push(a));
    newGmSessions.forEach(s => sources.push(`session:${s}`));
    newGmBridgeChats.forEach(b => sources.push(`bridge:${newGmBridgePlatform}:${b}`));
    const next = [
      ...globalMemoryConfigs,
      {
        name: newGmName.trim(),
        sources: sources.length > 0 ? sources : undefined,
        enabled: true,
      },
    ];
    setGlobalMemoryConfigs(next);
    setNewGmName('');
    setNewGmChannels([]);
    setNewGmAgents([]);
    setNewGmSessions([]);
    setNewGmBridgePlatform('');
    setNewGmBridgeChats([]);
    saveGlobalMemoryConfigs(next);
  };

  const removeGlobalMemoryConfig = async (index: number) => {
    const removed = globalMemoryConfigs[index];
    const next = globalMemoryConfigs.filter((_, i) => i !== index);
    setGlobalMemoryConfigs(next);
    // Clean up channel frontmatter for removed config
    if (removed?.sources) {
      const channelSources = removed.sources.filter((s: string) => s.startsWith('ch_'));
      for (const src of channelSources) {
        const channelId = src.replace('ch_', '');
        try {
          await hanaFetch(`/api/conversations/${encodeURIComponent(channelId)}/agent-phone-settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              globalMemory: false,
              globalMemorySources: [],
            }),
          });
        } catch (err) {
          console.error(`[dev] Failed to cleanup channel ${channelId}:`, err);
        }
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
          label={'选择 Agent'}
          hint={'可多选'}
          layout="stacked"
          control={
            <select
              className={styles['settings-input']}
              multiple
              value={newGmAgents}
              onChange={(e) => setNewGmAgents(Array.from(e.target.selectedOptions, o => o.value))}
              style={{ width: '100%', minHeight: '80px' }}
            >
              {agents.map(a => (
                <option key={a.id} value={a.id}>{a.name || a.id}</option>
              ))}
            </select>
          }
        />
        <SettingsRow
          label={'选择频道'}
          hint={'可多选'}
          layout="stacked"
          control={
            <select
              className={styles['settings-input']}
              multiple
              value={newGmChannels}
              onChange={(e) => setNewGmChannels(Array.from(e.target.selectedOptions, o => o.value))}
              style={{ width: '100%', minHeight: '80px' }}
            >
              {channels.map(ch => (
                <option key={ch.id} value={ch.id}>{ch.name || ch.id}</option>
              ))}
            </select>
          }
        />
        <SettingsRow
          label={'选择聊天'}
          hint={'从主聊天区已有的聊天中多选'}
          layout="stacked"
          control={
            <select
              className={styles['settings-input']}
              multiple
              value={newGmSessions}
              onChange={(e) => setNewGmSessions(Array.from(e.target.selectedOptions, o => o.value))}
              style={{ width: '100%', minHeight: '80px' }}
            >
              {chatSessions.map((s: any) => (
                <option key={s.path} value={s.path}>{s.title || s.path}</option>
              ))}
            </select>
          }
        />
        <SettingsRow
          label={'选择社交平台聊天'}
          hint={'先选平台，再选该平台的具体聊天'}
          layout="stacked"
          control={
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
              <select
                className={styles['settings-input']}
                value={newGmBridgePlatform}
                onChange={(e) => { setNewGmBridgePlatform(e.target.value); setNewGmBridgeChats([]); }}
                style={{ width: '100%' }}
              >
                <option value="">选择平台...</option>
                {bridgePlatforms.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              {newGmBridgePlatform && (
                <select
                  className={styles['settings-input']}
                  multiple
                  value={newGmBridgeChats}
                  onChange={(e) => setNewGmBridgeChats(Array.from(e.target.selectedOptions, o => o.value))}
                  style={{ width: '100%', minHeight: '80px' }}
                >
                  {bridgeSessions
                    .filter((s: any) => s.platform === newGmBridgePlatform)
                    .map((s: any) => (
                      <option key={s.chatId} value={s.chatId}>{s.displayName || s.chatId}</option>
                    ))}
                </select>
              )}
            </div>
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
