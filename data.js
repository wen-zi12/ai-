/* ============================================================
 * 聊吧待办 · 共享数据层（两页面共用）
 * ============================================================ */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'chat_todo_data_v1';
  const THEME_KEY = 'chat_todo_theme';

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function save(todos) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(todos)); }
    catch (e) { console.warn('保存失败', e); }
  }

  function loadTheme() {
    return localStorage.getItem(THEME_KEY) || 'light';
  }
  function saveTheme(t) {
    localStorage.setItem(THEME_KEY, t);
  }

  // 生成唯一 id
  function uid() {
    return 'todo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  }

  // 安全化来源链接：仅允许 http/https，阻断 javascript: 等协议注入
  function sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    try {
      const u = new URL(url.trim());
      return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '';
    } catch (e) { return ''; }
  }

  // 提取结果 -> todo 对象
  function makeTodo(extracted, source) {
    return {
      id: uid(),
      content: extracted.content,
      deadline: extracted.deadline || '',       // 显示文本
      deadlineTime: extracted.deadlineTime || null, // 时间戳
      assignee: extracted.assignee || '',
      location: extracted.location || '',
      source: source || '其他',
      sourceUrl: sanitizeUrl(extracted.sourceUrl),  // 来源链接（仅 http/https，防注入）
      speaker: extracted.speaker || '',
      priority: extracted.priority || 'normal',
      done: false,
      createdAt: Date.now(),
      remindAt: null        // 提醒时间戳（闹钟）
    };
  }

  global.TodoData = { load, save, loadTheme, saveTheme, uid, sanitizeUrl, makeTodo, STORAGE_KEY };
})(typeof window !== 'undefined' ? window : globalThis);
