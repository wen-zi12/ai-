/* ============ 导入页逻辑（聊天/公众号/PDF/Word） ============ */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  let currentSource = '微信';
  let currentTab = 'chat';
  let fileText = { pdf: '', word: '' };   // 文件解析出的文本
  let fileSource = { pdf: 'PDF', word: 'Word' };

  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 3000);
  }

  function updateBadge() {
    $('tabBadge').textContent = TodoData.load().filter(t => !t.done).length;
  }

  function applyTheme() {
    const t = TodoData.loadTheme();
    document.documentElement.setAttribute('data-theme', t);
    $('themeToggle').textContent = t === 'dark' ? '☀️' : '🌙';
  }

  // ---------- 标签切换 ----------
  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.source-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    $('panel-' + tab).classList.add('active');
    $('autoSwitchWrap').style.display = (tab === 'chat' || tab === 'article') ? 'flex' : 'none';
  }

  // ---------- 字数统计 ----------
  function bindCount(inputId, countId) {
    const input = $(inputId), count = $(countId);
    input.addEventListener('input', () => { count.textContent = input.value.length + ' 字'; });
  }

  // ---------- 提取 ----------
  function doExtract() {
    let text = '', source = '', articleUrl = '';
    if (currentTab === 'chat') {
      text = $('chatInput').value.trim();
      source = currentSource;
    } else if (currentTab === 'article') {
      text = TodoFiles.cleanArticleText($('articleInput').value.trim());
      source = '公众号';
      articleUrl = $('articleUrl').value.trim();
    } else if (currentTab === 'pdf') {
      text = fileText.pdf.trim();
      source = 'PDF';
    } else if (currentTab === 'word') {
      text = fileText.word.trim();
      source = 'Word';
    }

    if (!text) {
      toast(currentTab === 'chat' || currentTab === 'article' ? '请先粘贴内容' : '请先上传文件');
      return;
    }

    const extracted = ExtractionEngine.extractTodos(text, source);
    if (!extracted.length) {
      toast('😕 没识别到待办，试试「记得/明天/截止/地点：XX」等表达');
      return;
    }

    const todos = TodoData.load();
    let added = 0;
    extracted.forEach(e => {
      const exists = todos.some(o => o.content === e.content && o.source === source && !o.done);
      if (!exists) {
        e.sourceUrl = articleUrl;
        todos.push(TodoData.makeTodo(e, source)); added++;
      }
    });
    TodoData.save(todos);
    updateBadge();

    // 清空当前来源
    if (currentTab === 'chat') $('chatInput').value = '';
    if (currentTab === 'article') {
      $('articleInput').value = '';
      $('articleInput').dispatchEvent(new Event('input'));
      if ($('articleUrl')) $('articleUrl').value = '';
      if ($('linkStatus')) { $('linkStatus').style.display = 'none'; $('linkStatus').textContent = ''; }
    }
    if (currentTab === 'pdf' || currentTab === 'word') {
      fileText[currentTab] = '';
      $(currentTab + 'Result').style.display = 'none';
    }

    toast(`✅ 识别 ${extracted.length} 条，新增 ${added} 条，正在打开待办…`);
    setTimeout(() => { window.location.href = 'todos.html'; }, 700);
  }

  // ---------- 文件处理 ----------
  async function handleFile(file, kind) {
    if (!file) return;
    try {
      toast('⏳ 正在解析 ' + file.name + ' …');
      const text = await TodoFiles.parseFile(file);
      if (!text || !text.trim()) { toast('⚠️ 文档里没有可提取的文字'); return; }
      fileText[kind] = text;
      $(kind + 'Name').textContent = file.name + '（' + text.length + ' 字）';
      $(kind + 'Preview').textContent = text.slice(0, 300) + (text.length > 300 ? '…' : '');
      $(kind + 'Result').style.display = 'block';
      toast('✅ 已解析 ' + file.name + '，点击「提取待办事项」继续');
    } catch (e) {
      toast(e.message || '解析失败');
    }
  }

  // ---------- 事件 ----------
  function bind() {
    $('sourceTabs').addEventListener('click', e => {
      const btn = e.target.closest('.source-tab');
      if (btn) switchTab(btn.dataset.tab);
    });

    $('sourceOptions').addEventListener('click', e => {
      const btn = e.target.closest('.source-btn');
      if (!btn) return;
      document.querySelectorAll('.source-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentSource = btn.dataset.source;
    });

    bindCount('chatInput', 'charCount');
    bindCount('articleInput', 'articleCount');

    // 粘贴自动提取（仅聊天标签）
    $('chatInput').addEventListener('paste', () => {
      if (currentTab === 'chat' && $('autoExtract').checked) setTimeout(doExtract, 80);
    });
    $('chatInput').addEventListener('change', () => {
      if (currentTab === 'chat' && $('autoExtract').checked && $('chatInput').value.trim()) setTimeout(doExtract, 80);
    });
    $('articleInput').addEventListener('paste', () => {
      if (currentTab === 'article' && $('autoExtract').checked) setTimeout(doExtract, 80);
    });

    // 公众号：链接读取正文
    const readBtn = $('readArticleBtn');
    if (readBtn) readBtn.addEventListener('click', async () => {
      const url = $('articleUrl').value.trim();
      const status = $('linkStatus');
      if (!url) { toast('请先粘贴公众号文章链接'); return; }
      if (!TodoFiles.looksLikeWechatArticle(url) && !/^https?:\/\//i.test(url)) {
        toast('请输入完整链接（http:// 或 https:// 开头）'); return;
      }
      status.style.display = 'block';
      status.className = 'link-status loading';
      status.textContent = '⏳ 正在读取文章正文，请稍候…';
      readBtn.disabled = true;
      try {
        const res = await TodoFiles.fetchArticle(url);
        $('articleInput').value = res.text;
        $('articleInput').dispatchEvent(new Event('input'));
        status.className = 'link-status ok';
        status.textContent = `✅ 已读取 ${res.text.length} 字（${res.via}），点击下方「提取待办事项」继续。`;
        toast('✅ 正文读取成功');
      } catch (e) {
        status.className = 'link-status err';
        status.textContent = '⚠️ ' + (e.message || '读取失败') + ' 你也可以在下方手动粘贴正文。';
        toast('读取失败，可手动粘贴正文');
      } finally {
        readBtn.disabled = false;
      }
    });

    $('extractBtn').addEventListener('click', doExtract);
    $('demoBtn').addEventListener('click', () => {
      $('chatInput').value = `小明 10:23
记得明天下午3点前把方案发给客户

小红 10:25
帮我订一下周五去上海的机票，尽快

组长 14:00
下周一之前在会议室提交季度报告`;
      $('chatInput').dispatchEvent(new Event('input'));
      toast('已填入示例');
    });
    $('clearBtn').addEventListener('click', () => {
      $('chatInput').value = ''; $('chatInput').dispatchEvent(new Event('input')); $('chatInput').focus();
    });
    $('clearArticleBtn').addEventListener('click', () => {
      $('articleInput').value = ''; $('articleInput').dispatchEvent(new Event('input'));
      if ($('articleUrl')) $('articleUrl').value = '';
      if ($('linkStatus')) { $('linkStatus').style.display = 'none'; $('linkStatus').textContent = ''; }
    });

    // 文件上传
    ['pdf', 'word'].forEach(kind => {
      const fileInput = $(kind + 'File');
      const btn = document.querySelector('[data-input="' + kind + 'File"]');
      if (btn) btn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', e => handleFile(e.target.files[0], kind));
      const drop = $(kind + 'Drop');
      drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
      drop.addEventListener('drop', e => {
        e.preventDefault(); drop.classList.remove('dragover');
        handleFile(e.dataTransfer.files[0], kind);
      });
      $(kind + 'Clear').addEventListener('click', () => {
        fileText[kind] = '';
        $(kind + 'Result').style.display = 'none';
        fileInput.value = '';
      });
    });

    $('themeToggle').addEventListener('click', () => {
      const next = TodoData.loadTheme() === 'dark' ? 'light' : 'dark';
      TodoData.saveTheme(next); applyTheme();
    });
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doExtract(); }
    });
  }

  applyTheme();
  updateBadge();
  bind();
  TodoNotify.init();
})();
