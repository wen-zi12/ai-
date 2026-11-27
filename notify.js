/* ============================================================
 * 聊吧待办 · 提醒模块
 * 手机端：Capacitor Local Notifications（系统级定时通知/闹钟）
 * 网页/桌面端：浏览器 Notification API
 * ============================================================ */
(function (global) {
  'use strict';

  let LocalNotifications = null;
  let nativeReady = false;

  // 网页/桌面端的定时器登记表：todoId -> { timers: [timerId], target: ts }
  // 用于取消提醒 & 页面重载后恢复；setTimeout 有 ~24.85 天上限，长周期需分段调度
  const webTimers = new Map();
  const MAX_DELAY = 2147483647; // setTimeout 上限（ms）
  const SEGMENT = 2140000000;   // 分段长度，留出余量

  function clearWebTimer(todoId) {
    const rec = webTimers.get(todoId);
    if (rec) {
      rec.timers.forEach(t => clearTimeout(t));
      webTimers.delete(t);
    }
  }

  function isNative() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }

  // 初始化本地通知插件（手机端）
  async function init() {
    if (!isNative()) return false;
    try {
      // Capacitor 8 插件通过 @capacitor/core 注册，全局暴露在 Capacitor.Plugins
      const plugins = window.Capacitor.Plugins || {};
      LocalNotifications = plugins.LocalNotifications;
      if (!LocalNotifications) return false;
      // 只读取权限状态，不主动弹系统权限框；真正的申请走 ensurePermissionWithGuide 引导流程
      if (typeof LocalNotifications.checkPermissions === 'function') {
        await LocalNotifications.checkPermissions();
      }
      if (!nativeReady) {
        await LocalNotifications.addListeners({
          localNotificationReceived: () => {},
          localNotificationActionPerformed: () => {}
        });
        nativeReady = true;
      }
      return true;
    } catch (e) {
      console.warn('本地通知初始化失败', e);
      return false;
    }
  }

  // 读取当前权限状态：granted / denied / prompt / unsupported
  async function checkPermission() {
    if (isNative()) {
      try {
        if (!LocalNotifications) {
          const plugins = window.Capacitor.Plugins || {};
          LocalNotifications = plugins.LocalNotifications;
        }
        if (!LocalNotifications || typeof LocalNotifications.checkPermissions !== 'function') return 'prompt';
        const r = await LocalNotifications.checkPermissions();
        const d = r && r.display;
        if (d === 'granted' || d === 'provisional') return 'granted';
        if (d === 'denied') return 'denied';
        return 'prompt';
      } catch (e) { return 'prompt'; }
    }
    if ('Notification' in window) {
      const p = Notification.permission;
      if (p === 'granted') return 'granted';
      if (p === 'denied') return 'denied';
      return 'prompt';
    }
    return 'unsupported';
  }

  // 申请权限（返回一个 Promise<boolean>）
  async function requestPermission() {
    if (isNative()) {
      try {
        if (!LocalNotifications) {
          const plugins = window.Capacitor.Plugins || {};
          LocalNotifications = plugins.LocalNotifications;
        }
        if (!LocalNotifications) return false;
        const r = await LocalNotifications.requestPermissions();
        return r.display === 'granted';
      } catch (e) { return false; }
    }
    if ('Notification' in window) {
      if (Notification.permission === 'granted') return true;
      const r = await Notification.requestPermission();
      return r === 'granted';
    }
    return false;
  }

  // 跳转到系统/应用的通知设置页；网页端无法直接跳转则返回 false
  function openSettings() {
    if (isNative()) {
      try {
        const App = (window.Capacitor && window.Capacitor.Plugins || {}).App;
        if (App && typeof App.openUrl === 'function') {
          App.openUrl({ url: 'app-settings:' }).catch(function () {});
          return true;
        }
      } catch (e) {}
      // 通用 scheme：Android / iOS 均支持跳转应用设置
      try { window.location.href = 'app-settings:'; return true; } catch (e) {}
    }
    return false;
  }

  // ============ 权限引导弹窗（前置说明 + 被拒后跳系统设置） ============
  let guideMask = null;
  function closeGuide() {
    if (guideMask && guideMask.parentNode) guideMask.parentNode.removeChild(guideMask);
    guideMask = null;
  }

  // status: prompt（首次）/ denied（被拒）；resolve(true) 表示权限已可用
  function showPermissionGuide(status, resolve) {
    closeGuide();
    const denied = status === 'denied';
    const native = isNative();
    const mask = document.createElement('div');
    mask.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:300;padding:20px;';
    mask.innerHTML =
      '<div style="width:100%;max-width:380px;background:var(--card);color:var(--text);border-radius:16px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.3);font-family:inherit;">' +
        '<div style="font-size:40px;text-align:center;margin-bottom:10px;">🔔</div>' +
        '<h3 style="font-size:17px;text-align:center;margin-bottom:8px;">' + (denied ? '通知权限未开启' : '需要通知权限') + '</h3>' +
        '<p style="font-size:13px;color:var(--sub);line-height:1.7;margin-bottom:14px;">' +
          (denied
            ? '通知权限已被关闭，到点的提醒将无法弹出。请开启后返回应用。'
            : '为了在待办的截止时间到点时准时提醒你，需要开启通知权限。提醒完全在本地运行，不会上传你的任何数据。') +
        '</p>' +
        (denied
          ? '<div style="font-size:12px;color:var(--sub);background:var(--bg);border-radius:8px;padding:10px 12px;margin-bottom:18px;line-height:1.6;">' +
              (native ? '路径：系统设置 → 应用 → 聊吧待办 → 通知 → 允许' : '请在浏览器地址栏的锁形图标中，把通知改为「允许」') +
            '</div>'
          : '') +
        '<div style="display:flex;gap:10px;justify-content:flex-end;">' +
          '<button data-act="cancel" style="padding:10px 16px;border:1px solid var(--border);background:var(--card);color:var(--sub);border-radius:9px;font-size:14px;cursor:pointer;font-family:inherit;">暂不</button>' +
          '<button data-act="ok" style="padding:10px 16px;border:none;background:var(--primary);color:#fff;border-radius:9px;font-size:14px;cursor:pointer;font-family:inherit;">' +
            (denied ? (native ? '去系统设置开启' : '我知道了') : '允许通知') +
          '</button>' +
        '</div>' +
      '</div>';
    guideMask = mask;
    document.body.appendChild(mask);

    mask.querySelector('[data-act="cancel"]').onclick = function () { closeGuide(); resolve(false); };
    mask.querySelector('[data-act="ok"]').onclick = async function () {
      closeGuide();
      if (denied) {
        // 已被拒绝：系统不会再弹申请框，引导去设置页手动开启
        openSettings();
        resolve(false);
        return;
      }
      // 首次申请：弹系统权限框
      const ok = await requestPermission();
      if (ok) { resolve(true); return; }
      // 申请后仍被拒：再次引导，这次提供跳转设置入口
      showPermissionGuide('denied', resolve);
    };
  }

  // 统一入口：检查权限 → 需要时引导 → 返回权限是否可用
  async function ensurePermissionWithGuide() {
    const status = await checkPermission();
    if (status === 'granted') return true;
    if (status === 'unsupported') return false;
    return new Promise(resolve => showPermissionGuide(status, resolve));
  }

  // 设置一条提醒
  // @param todo  {id, content, ...}
  // @param time  {hour, minute} 或 Date
  async function schedule(todo, date) {
    const now = Date.now();
    const ts = date instanceof Date ? date.getTime() : date;
    if (!ts || ts <= now) return { ok: false, msg: '提醒时间必须晚于当前时间' };

    const id = todoIdToNumber(todo.id);
    const title = '⏰ 待办提醒';
    const timeInfo = dateStr(date);
    const placeInfo = todo.location ? ` · 📍${todo.location}` : '';
    const body = `${todo.content}\n⏰ ${timeInfo}${placeInfo}` + (todo.deadline ? `\n截止 ${todo.deadline}` : '');

    // 手机端：系统本地通知（可靠定时，即使 App 关闭也能提醒）
    if (isNative() && LocalNotifications) {
      try {
        const pending = await LocalNotifications.getPending();
        const exist = pending.notifications.some(n => n.id === id);
        if (exist) await LocalNotifications.cancel({ notifications: [{ id }] });
        await LocalNotifications.schedule({
          notifications: [{
            id,
            title,
            body,
            schedule: { at: new Date(ts) },
            sound: 'default',
            actionTypeId: '',
            extra: { todoId: todo.id }
          }]
        });
        return { ok: true, msg: '已设置手机闹钟提醒', native: true };
      } catch (e) {
        console.warn('系统通知设置失败', e);
        // 继续尝试浏览器方式兜底
      }
    }

    // 网页/桌面端：浏览器通知 + 页面内定时器（分段调度，突破 24.85 天上限）
    if ('Notification' in window && Notification.permission === 'granted') {
      clearWebTimer(todo.id); // 先清除该待办已有的旧定时器，避免重复弹通知
      const rec = { timers: [], target: ts, title, body };
      webTimers.set(todo.id, rec);
      armSegmented(rec, todo.id, ts, now);
      return { ok: true, msg: '已设置提醒（需保持页面/App 打开）', native: false, segmented: ts - now > SEGMENT };
    }
    return { ok: false, msg: '提醒未生效，请检查通知权限' };
  }

  // 分段定时器：每次最多等待 SEGMENT，时间未到则继续排下一段，直到真正到点
  function armSegmented(rec, todoId, target, now) {
    const fire = () => {
      // 目标已过或被取消，直接结束
      if (!webTimers.has(todoId)) return;
      const remain = target - Date.now();
      if (remain > 1000) {
        // 还没到，再排一段
        const t = setTimeout(fire, Math.min(remain, SEGMENT));
        rec.timers.push(t);
        return;
      }
      // 到点：弹通知
      try { new Notification(rec.title, { body: rec.body }); } catch (e) {}
      clearWebTimer(todoId);
    };
    const first = setTimeout(fire, Math.min(Math.max(target - now, 0), SEGMENT));
    rec.timers.push(first);
  }

  // 恢复提醒：页面重载后，根据已保存的 remindAt 重新登记网页端定时器
  // 仅处理尚未到点的提醒；手机端由系统通知托管，无需恢复
  function restore(todos) {
    if (isNative()) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const now = Date.now();
    (todos || []).forEach(t => {
      if (!t.remindAt || t.done || t.remindAt <= now) return;
      if (webTimers.has(t.id)) return; // 已登记
      const rec = {
        timers: [],
        target: t.remindAt,
        title: '⏰ 待办提醒',
        body: `${t.content}\n⏰ ${dateStr(new Date(t.remindAt))}` + (t.location ? ` · 📍${t.location}` : '')
      };
      webTimers.set(t.id, rec);
      armSegmented(rec, t.id, t.remindAt, now);
    });
  }

  // 取消一条提醒（手机端 + 网页端双清，避免幽灵提醒）
  async function cancel(todoId) {
    clearWebTimer(todoId); // 网页/桌面端：清除已登记的定时器
    const id = todoIdToNumber(todoId);
    if (isNative() && LocalNotifications) {
      try { await LocalNotifications.cancel({ notifications: [{ id }] }); }
      catch (e) { console.warn('取消通知失败', e); }
    }
  }

  function dateStr(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // 把字符串 id 转成数字 id（Capacitor 要求数字 id）
  function todoIdToNumber(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h) % 2000000000 + 1;
  }

  global.TodoNotify = { init, checkPermission, requestPermission, ensurePermissionWithGuide, openSettings, schedule, cancel, restore, isNative };
})(typeof window !== 'undefined' ? window : globalThis);
