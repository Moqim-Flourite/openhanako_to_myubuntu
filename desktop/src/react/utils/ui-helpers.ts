/**
 * ui-helpers.ts — 连接状态 / 错误提示 / 模型加载
 *
 * 纯 store 操作，无 DOM 依赖。
 */

import { useStore } from '../stores';
import { hanaFetch } from '../hooks/use-hana-fetch';

// ── 连接状态 ──

export function setStatus(key: string, connected: boolean, vars: Record<string, string | number> = {}): void {
  useStore.setState({ connected, statusKey: key, statusVars: vars });
}

// ── 错误显示 ──

export function showError(message: string): void {
  console.error('[hana]', message);
  useStore.getState().addToast(`\u26A0 ${message}`, 'error');
}

// ── 模型加载 ──

export async function loadModels(): Promise<void> {
  try {
    window.__hanaLog?.('info', 'renderer-models', 'loadModels:start');
    const res = await hanaFetch('/api/models/favorites');
    const data = await res.json();
    const models = Array.isArray(data.models) ? data.models : [];
    console.log('[renderer/models] loadModels:favorites-success', {
      modelCount: models.length,
      current: data.current ?? null,
      ids: models.map((m: any) => m?.id).filter(Boolean),
    });
    window.__hanaLog?.(
      'info',
      'renderer-models',
      `loadModels:favorites-success count=${models.length} current=${data.current || '-'} ids=${models.map((m: any) => m?.id).filter(Boolean).join(',')}`,
    );

    if (models.length > 0) {
      useStore.setState({
        models,
        currentModel: data.current,
      });
      return;
    }

    window.__hanaLog?.('warn', 'renderer-models', 'loadModels:favorites-empty fallback=/api/models');
    const fallbackRes = await hanaFetch('/api/models');
    const fallbackData = await fallbackRes.json();
    const fallbackModels = Array.isArray(fallbackData.models) ? fallbackData.models : [];
    console.log('[renderer/models] loadModels:fallback-success', {
      modelCount: fallbackModels.length,
      current: fallbackData.current ?? null,
      ids: fallbackModels.map((m: any) => m?.id).filter(Boolean),
    });
    window.__hanaLog?.(
      'info',
      'renderer-models',
      `loadModels:fallback-success count=${fallbackModels.length} current=${fallbackData.current || '-'} ids=${fallbackModels.map((m: any) => m?.id).filter(Boolean).join(',')}`,
    );
    useStore.setState({
      models: fallbackModels,
      currentModel: fallbackData.current ?? null,
    });
  } catch (err: any) {
    console.error('[renderer/models] loadModels:error', err);
    window.__hanaLog?.('error', 'renderer-models', `loadModels:error ${err?.stack || err?.message || String(err)}`);
    useStore.setState({
      models: [],
      currentModel: null,
    });
  }
}

