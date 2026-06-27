/**
 * NotesPanel — 多便签编辑器（terminal 式 tab 切换）
 *
 * 右侧栏便签面板，支持多条便签、tab 切换、新建、重命名、删除。
 * 数据存储在 desk 目录的 notes/ 子目录下。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../../stores';
import {
  loadNotes,
  loadNoteContent,
  saveNoteContent,
  createNote,
  deleteNote,
  renameNote,
} from '../../stores/desk-actions';
import type { NoteTab } from '../../stores/desk-slice';
import styles from './NotesPanel.module.css';

const t = (key: string) => window.t?.(key) ?? key;

/** 单个 tab 项 */
function NoteTabItem({
  tab,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  tab: NoteTab;
  active: boolean;
  onSelect: () => void;
  onRename: (newTitle: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(tab.title);
  const [contextMenu, setContextMenu] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 双击进入编辑模式
  const handleDoubleClick = useCallback(() => {
    setEditing(true);
    setEditValue(tab.title);
  }, [tab.title]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commitRename = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== tab.title) {
      onRename(trimmed);
    }
    setEditing(false);
  }, [editValue, tab.title, onRename]);

  // 右键菜单
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu(true);
  }, []);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [contextMenu]);

  return (
    <div
      className={`${styles.tab}${active ? ` ${styles.tabActive}` : ''}`}
      onClick={onSelect}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
    >
      {editing ? (
        <input
          ref={inputRef}
          className={styles.tabEditInput}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <span className={styles.tabTitle}>{tab.title}</span>
      )}
      {contextMenu && (
        <div ref={menuRef} className={styles.contextMenu}>
          <button
            className={styles.contextMenuItem}
            onClick={(e) => {
              e.stopPropagation();
              setContextMenu(false);
              setEditing(true);
            }}
          >
            {t('notes.rename') || '重命名'}
          </button>
          <button
            className={`${styles.contextMenuItem} ${styles.contextMenuDanger}`}
            onClick={(e) => {
              e.stopPropagation();
              setContextMenu(false);
              onDelete();
            }}
          >
            {t('notes.delete') || '删除'}
          </button>
        </div>
      )}
    </div>
  );
}

/** 便签编辑器 */
function NoteEditor() {
  const activeNoteId = useStore((s) => s.activeNoteId);
  const noteContent = useStore((s) => s.noteContent);
  const [localValue, setLocalValue] = useState('');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevNoteRef = useRef<string | null>(null);

  // 同步 store 内容到本地
  useEffect(() => {
    if (noteContent !== null && noteContent !== undefined) {
      setLocalValue(noteContent);
    } else {
      setLocalValue('');
    }
  }, [noteContent]);

  // 切换笔记时保存旧的、加载新的
  useEffect(() => {
    if (prevNoteRef.current && prevNoteRef.current !== activeNoteId) {
      // 保存旧笔记
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    }
    prevNoteRef.current = activeNoteId;
  }, [activeNoteId]);

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      setLocalValue(value);
      if (!activeNoteId) return;
      // 防抖保存
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveNoteContent(activeNoteId, value);
      }, 800);
    },
    [activeNoteId],
  );

  if (!activeNoteId) {
    return (
      <div className={styles.empty}>
        <span>{t('notes.empty') || '点击 + 新建便签'}</span>
      </div>
    );
  }

  return (
    <textarea
      className={styles.editor}
      placeholder={t('notes.placeholder') || '写点什么...'}
      spellCheck={false}
      value={localValue}
      onChange={handleInput}
    />
  );
}

/** 便签面板主组件 */
export function NotesPanel() {
  const noteTabs = useStore((s) => s.noteTabs);
  const activeNoteId = useStore((s) => s.activeNoteId);
  const setActiveNoteId = useStore((s) => s.setActiveNoteId);
  const setNoteContent = useStore((s) => s.setNoteContent);

  // 初始化：加载笔记列表
  useEffect(() => {
    loadNotes();
  }, []);

  // 切换活跃笔记时加载内容
  useEffect(() => {
    if (activeNoteId) {
      loadNoteContent(activeNoteId);
    } else {
      setNoteContent(null);
    }
  }, [activeNoteId, setNoteContent]);

  const handleCreate = useCallback(async () => {
    await createNote();
  }, []);

  const handleDelete = useCallback(
    async (noteId: string) => {
      await deleteNote(noteId);
    },
    [],
  );

  const handleRename = useCallback(
    async (oldId: string, newTitle: string) => {
      await renameNote(oldId, newTitle);
    },
    [],
  );

  const handleSelect = useCallback(
    (noteId: string) => {
      setActiveNoteId(noteId);
    },
    [setActiveNoteId],
  );

  return (
    <div className={styles.shell}>
      <div className={styles.tabBar}>
        <div className={styles.tabList}>
          {noteTabs.map((tab) => (
            <NoteTabItem
              key={tab.id}
              tab={tab}
              active={tab.id === activeNoteId}
              onSelect={() => handleSelect(tab.id)}
              onRename={(newTitle) => handleRename(tab.id, newTitle)}
              onDelete={() => handleDelete(tab.id)}
            />
          ))}
        </div>
        <button
          className={styles.addTab}
          onClick={handleCreate}
          title={t('notes.new') || '新建便签'}
        >
          +
        </button>
      </div>
      <NoteEditor />
    </div>
  );
}
