/* ============ 待办页逻辑（含提醒设置） ============ */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const todoList = $('todoList');
  let todos = [];
  let currentFilter = 'all';
  let remindTargetId = null;
  let editTargetId = null;

  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 3000);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // 渲染「原文」链接前二次校验协议，阻断历史脏数据里的 javascript: 注入
  function safeLink(url) {
    const u = (TodoData && TodoData.sanitizeUrl) ? TodoData.sanitizeUrl(url) : '';
    return u ? escapeHtml(u) : '';
  }

  function applyTheme() {
    const t = TodoData.loadTheme();
    document.documentElement.setAttribute('data-theme', t);
    $('themeToggle').textContent = t === 'dark' ? '☀️' : '🌙';
  }

  function fmtRemind(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return sameDay ? `今天 ${time}` : `${d.getMonth() + 1}月${d.getDate()}日 ${time}`;
  }

  function render() {
    // 统计
    $('statTotal').textContent = todos.length;
    $('statPending').textContent = todos.filter(t => !t.done).length;
    $('statDone').textContent = todos.filter(t => t.done).length;
    $('statAlarm').textContent = todos.filter(t => t.remindAt && !t.done).length;
    $('tabBadge').textContent = todos.filter(t => !t.done).length;

    const filtered = todos.filter(t => {
      if (currentFilter === 'all') return true;
      if (currentFilter === 'pending') return !t.done;
      if (currentFilter === 'done') return t.done;
      return t.source === currentFilter;
    });

    if (!filtered.length) {
      todoList.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div>
        <p>${todos.length === 0 ? '还没有待办事项' : '当前筛选下没有待办'}</p>
        <span>${todos.length === 0 ? '去「粘贴」页导入聊天记录吧' : '换个筛选条件看看'}</span></div>`;
      return;
    }

    filtered.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (a.priority !== b.priority) return a.priority === 'high' ? -1 : 1;
      const ta = a.remindAt || a.deadlineTime, tb = b.remindAt || b.deadlineTime;
      if (ta && tb) return ta - tb;
      if (ta) return -1;
      if (tb) return 1;
      return 0;
    });

    todoList.innerHTML = filtered.map(t => {
      const srcClass = t.source === '微信' ? 'source-wechat' : t.source === 'QQ' ? 'source-qq' : 'source-other';
      const srcIcon = t.source === '微信' ? '💬' : t.source === 'QQ' ? '🐧' : '📋';
      return `
        <div class="todo-item ${t.done ? 'done' : ''}" data-id="${t.id}">
          <div class="todo-check" data-act="toggle" title="标记完成">✓</div>
          <div class="todo-body">
            <div class="todo-content">${escapeHtml(t.content)}</div>
            <div class="todo-meta">
              <span class="tag ${srcClass}">${srcIcon} ${escapeHtml(t.source)}</span>
              ${safeLink(t.sourceUrl) ? `<a class="tag source-link" data-act="source" href="${safeLink(t.sourceUrl)}" target="_blank" rel="noopener noreferrer" title="打开原文链接">🔗 原文</a>` : ''}
              ${t.deadline ? `<span class="tag deadline">⏰ ${escapeHtml(t.deadline)}</span>` : ''}
              ${t.location ? `<span class="tag location">📍 ${escapeHtml(t.location)}</span>` : ''}
              ${t.assignee ? `<span class="tag assignee">👤 ${escapeHtml(t.assignee)}</span>` : ''}
              ${t.priority === 'high' ? `<span class="tag priority-high">🔥 紧急</span>` : ''}
              ${t.remindAt ? `<span class="tag alarm" data-act="remind" title="点击修改提醒">🔔 ${fmtRemind(t.remindAt)}</span>` : ''}
            </div>
          </div>
          <div class="todo-actions">
            <button data-act="remind" title="设置提醒">🔔</button>
            <button data-act="edit" title="编辑">✏️</button>
            <button class="del" data-act="delete" title="删除">🗑</button>
          </div>
        </div>`;
    }).join('');
  }

  function persist() { TodoData.save(todos); render(); }

  // ---------- 提醒弹窗 ----------
  async function openRemind(id) {
    remindTargetId = id;
    const t = todos.find(x => x.id === id);
    if (!t) return;
    $('remindTaskName').textContent = t.content;
    $('remindLocation').value = t.location || '';

    if (t.remindAt) {
      const d = new Date(t.remindAt);
      const pad = n => String(n).padStart(2, '0');
      $('remindTime').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      $('remindRemove').style.display = 'inline-block';
    } else {
      $('remindTime').value = '';
      $('remindRemove').style.display = 'none';
    }

    const granted = await TodoNotify.ensurePermissionWithGuide();
    $('permissionHint').textContent = granted
      ? (TodoNotify.isNative() ? '✓ 已获得通知权限，提醒会在到点时弹出' : '✓ 已获得通知权限（网页版需保持页面打开）')
      : '⚠️ 未获得通知权限，提醒可能无法弹出。点「设置提醒」可重新授权或跳转系统设置开启。';

    $('remindModal').classList.add('show');
  }

  function closeRemind() { $('remindModal').classList.remove('show'); remindTargetId = null; }

  async function saveRemind() {
    const t = todos.find(x => x.id === remindTargetId);
    const val = $('remindTime').value;
    if (!t) return closeRemind();
    if (!val) { toast('请选择提醒时间'); return; }

    const date = new Date(val);
    // 无论通知权限是否就绪，都先保存提醒时间（数据不丢）
    const result = await TodoNotify.schedule(t, date);
    t.remindAt = date.getTime();
    t.location = $('remindLocation').value.trim();
    persist();
    closeRemind();
    toast(result.ok ? ('🔔 ' + result.msg) : ('已记录提醒时间 · ' + result.msg));
  }

  async function removeRemind() {
    const t = todos.find(x => x.id === remindTargetId);
    if (!t) return closeRemind();
    await TodoNotify.cancel(t.id);
    t.remindAt = null;
    persist();
    closeRemind();
    toast('已移除提醒');
  }

  // ---------- 编辑弹窗 ----------
  function openEdit(id) {
    const t = todos.find(x => x.id === id);
    if (!t) return;
    editTargetId = id;
    $('editContent').value = t.content;
    $('editDeadline').value = t.deadline || '';
    $('editLocation').value = t.location || '';
    $('editAssignee').value = t.assignee || '';
    $('editModal').classList.add('show');
  }
  function closeEdit() { $('editModal').classList.remove('show'); editTargetId = null; }
  function saveEdit() {
    const t = todos.find(x => x.id === editTargetId);
    if (!t) return closeEdit();
    t.content = $('editContent').value.trim() || t.content;
    t.deadline = $('editDeadline').value.trim();
    t.location = $('editLocation').value.trim();
    t.assignee = $('editAssignee').value.trim();
    persist(); closeEdit(); toast('✏️ 已更新');
  }

  // ---------- 导出 ----------
  function exportTodos() {
    if (!todos.length) { toast('没有可导出的待办'); return; }
    const lines = ['【聊吧待办 · 待办清单】', `导出时间：${new Date().toLocaleString('zh-CN')}`, ''];
    todos.forEach((t, i) => {
      lines.push(`${i + 1}. [${t.done ? '✓ 已完成' : '○ 待完成'}] ${t.content}`);
      const m = [];
      if (t.deadline) m.push(`截止：${t.deadline}`);
      if (t.remindAt) m.push(`提醒：${fmtRemind(t.remindAt)}`);
      if (t.location) m.push(`地点：${t.location}`);
      if (t.assignee) m.push(`负责人：${t.assignee}`);
      if (t.priority === 'high') m.push('紧急');
      m.push(`来源：${t.source}`);
      if (t.sourceUrl) m.push(`原文：${t.sourceUrl}`);
      if (m.length) lines.push(`   ${m.join(' · ')}`);
    });
    const text = lines.join('\n');
    if (TodoNotify.isNative() && navigator.share) {
      navigator.share({ title: '聊吧待办清单', text }).catch(() => copyFallback(text));
    } else if (TodoNotify.isNative()) {
      copyFallback(text);
    } else {
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `聊吧待办_${new Date().toISOString().slice(0, 10)}.txt`; a.click();
      URL.revokeObjectURL(url);
      toast('📤 已导出');
    }
  }
  function copyFallback(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => toast('📤 已复制到剪贴板')).catch(() => toast('⚠️ 复制失败'));
    } else { toast('⚠️ 请长按选择文本复制'); }
  }

  // ---------- 事件 ----------
  function bind() {
    $('filters').addEventListener('click', e => {
      const btn = e.target.closest('.filter-btn');
      if (!btn) return;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      render();
    });

    todoList.addEventListener('click', e => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const id = btn.closest('.todo-item').dataset.id;
      const act = btn.dataset.act;
      if (act === 'toggle') {
        const t = todos.find(x => x.id === id);
        if (t) { t.done = !t.done; persist(); toast(t.done ? '✅ 已完成' : '↩️ 已恢复'); }
      } else if (act === 'delete') {
        const t = todos.find(x => x.id === id);
        if (t && t.remindAt) TodoNotify.cancel(t.id);
        todos = todos.filter(x => x.id !== id);
        persist(); toast('🗑 已删除');
      } else if (act === 'edit') {
        openEdit(id);
      } else if (act === 'remind') {
        openRemind(id);
      }
    });

    $('remindCancel').addEventListener('click', closeRemind);
    $('remindSave').addEventListener('click', saveRemind);
    $('remindRemove').addEventListener('click', removeRemind);
    $('remindModal').addEventListener('click', e => { if (e.target === $('remindModal')) closeRemind(); });

    document.querySelectorAll('.quick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const min = parseInt(btn.dataset.min, 10);
        const d = new Date(Date.now() + min * 60000);
        const pad = n => String(n).padStart(2, '0');
        $('remindTime').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      });
    });

    $('editCancel').addEventListener('click', closeEdit);
    $('editSave').addEventListener('click', saveEdit);
    $('editModal').addEventListener('click', e => { if (e.target === $('editModal')) closeEdit(); });

    $('exportBtn').addEventListener('click', exportTodos);
    $('clearAllBtn').addEventListener('click', () => {
      if (!todos.length) return;
      if (confirm('确定清空全部待办吗？相关提醒也会取消。')) {
        todos.forEach(t => { if (t.remindAt) TodoNotify.cancel(t.id); });
        todos = []; persist(); toast('🗑 已清空');
      }
    });
    $('themeToggle').addEventListener('click', () => {
      const next = TodoData.loadTheme() === 'dark' ? 'light' : 'dark';
      TodoData.saveTheme(next); applyTheme();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closeRemind(); closeEdit(); }
    });
  }

  applyTheme();
  todos = TodoData.load();
  bind();
  render();
  TodoNotify.init();
  // 页面重载后恢复尚未到点的网页端提醒（分段计时，突破 setTimeout 上限）
  TodoNotify.restore(todos);
})();
