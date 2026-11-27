/* ============================================================
 * 聊吧待办 · 多来源内容解析
 * 支持：PDF / Word(.docx) / 公众号文章文本
 * PDF/Word/文本全部本地解析、不上传文件；公众号链接读取为联网功能，详见 fetchArticle 注释
 * ============================================================ */
(function (global) {
  'use strict';

  // ---------- PDF ----------
  async function parsePDF(file) {
    try {
      const pdfjsLib = await import('./vendor/pdf.min.mjs');
      pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.mjs';
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        const text = tc.items.map(it => it.str).join(' ');
        pages.push(text);
      }
      return pages.join('\n');
    } catch (e) {
      console.error('PDF 解析失败', e);
      throw new Error('PDF 解析失败：' + e.message);
    }
  }

  // ---------- Word (.docx) ----------
  async function parseDOCX(file) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      return result.value || '';
    } catch (e) {
      console.error('Word 解析失败', e);
      throw new Error('Word 解析失败：' + e.message);
    }
  }

  // ---------- 纯文本 ----------
  async function parseTXT(file) {
    return await file.text();
  }

  // ---------- 根据文件类型分发 ----------
  async function parseFile(file) {
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.pdf')) return parsePDF(file);
    if (name.endsWith('.docx') || name.endsWith('.doc')) {
      if (name.endsWith('.doc')) throw new Error('暂不支持旧版 .doc，请另存为 .docx');
      return parseDOCX(file);
    }
    if (name.endsWith('.txt') || name.endsWith('.md')) return parseTXT(file);
    throw new Error('不支持的文件格式，请选择 PDF / Word(.docx) / TXT');
  }

  // ---------- 清洗公众号文章文本 ----------
  function cleanArticleText(raw) {
    let t = raw.replace(/\r/g, '');
    // 去掉常见的公众号页脚/引导语
    const junk = [
      /^点击上方.*?关注我.*$/gm,
      /^长按识别二维码.*$/gm,
      /^扫描二维码.*$/gm,
      /^点击.*?阅读原文.*$/gm,
      /^免责声明[:：].*$/gm,
      /^本文由.*?发布.*$/gm,
      /^微信.*?公众号.*$/gm
    ];
    junk.forEach(re => { t = t.replace(re, ''); });
    // 合并过多空行
    t = t.replace(/\n{3,}/g, '\n\n').trim();
    return t;
  }

  // ---------- 公众号文章链接读取 ----------
  // 核心难点：浏览器/WebView 里的 JS 受 CORS 限制，无法直连 mp.weixin.qq.com。
  //
  // 解决方案分两条路：
  //   1) Android APK（Capacitor 原生环境）：用 CapacitorHttp 走原生网络层（OkHttp），
  //      不受 CORS 限制，还能伪装成微信浏览器 UA 绕过反爬 —— 这是真正可靠的方案。
  //   2) 普通网页：没有原生能力，退而求其次用公共文本化代理（受网络环境影响）。
  //
  // 隐私提示：App 走原生直连，链接直达微信服务器；网页版受 CORS 限制，链接会经过上述公共代理，
  // 这些第三方服务能看到你提交的链接，请勿用于敏感内容。待办数据本身始终只存本地。

  const WECHAT_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.47(0x18002f2a) NetType/WIFI Language/zh_CN';

  // 公共代理（仅网页端兜底）
  const ARTICLE_PROXIES = [
    { name: '文本化服务', build: url => 'https://r.jina.ai/' + url, parse: r => r },
    { name: '公共代理', build: url => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url), parse: extractFromHtml },
    { name: '备用代理', build: url => 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(url), parse: extractFromHtml }
  ];

  // 判断是否在 Capacitor 原生环境
  function isNative() {
    return !!(typeof window !== 'undefined' && window.Capacitor &&
      window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }

  // 从 HTML 中提取公众号正文（针对 #js_content / .rich_media_content）
  function extractFromHtml(html) {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      // 微信反爬拦截页特征
      const whole = doc.body ? (doc.body.textContent || '') : '';
      if (/请在微信客户端打开|环境异常|参数错误|系统繁忙/.test(whole)) return '';
      const root = doc.querySelector('#js_content') || doc.querySelector('.rich_media_content') ||
        doc.querySelector('article') || doc.querySelector('.rich_media_area_primary') || doc.body;
      if (!root) return '';
      root.querySelectorAll('script,style,noscript').forEach(n => n.remove());
      // 用段落/换行分隔，尽量保留可读结构
      let text = (root.innerText || root.textContent || '');
      text = text.replace(/\u00a0/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      return text;
    } catch (e) { return ''; }
  }

  function looksLikeWechatArticle(url) {
    return /mp\.weixin\.qq\.com\/s[\/?]/.test(url);
  }

  async function fetchWithTimeout(url, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'text/plain,text/html,*/*' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } finally { clearTimeout(timer); }
  }

  // 原生 HTTP 直连（仅 APK）：CapacitorHttp 走 OkHttp，无 CORS 限制
  // CapacitorHttp 是 @capacitor/core 内置插件，但必须在 capacitor.config.json
  // 的 plugins.CapacitorHttp.enabled=true 才会注册原生实现，否则会静默降级为 web fetch。
  async function fetchViaNative(url) {
    const cap = typeof window !== 'undefined' ? window.Capacitor : null;
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) {
      throw new Error('当前不是原生环境');
    }
    const plugins = cap.Plugins || {};
    const Http = plugins.CapacitorHttp || (typeof cap.CapacitorHttp !== 'undefined' ? cap.CapacitorHttp : null);
    if (!Http || typeof Http.get !== 'function') {
      throw new Error('原生 HTTP 插件未注册（请检查 capacitor.config.json 的 CapacitorHttp 配置）');
    }
    const res = await Http.get({
      url,
      headers: {
        'User-Agent': WECHAT_UA,
        'Accept': 'text/html,application/xhtml+xml,*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      },
      responseType: 'text',
      maxRedirects: 10,
      timeout: 20000,
      webFetchExtra: { redirect: 'follow' }
    });
    if (res.status < 200 || res.status >= 300) throw new Error('HTTP ' + res.status);
    const html = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    return extractFromHtml(html);
  }

  async function fetchArticle(url) {
    url = (url || '').trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('请输入以 http:// 或 https:// 开头的完整链接');

    // 路径 1：APK 原生直连 —— 最可靠
    let nativeErr = null;
    if (isNative()) {
      try {
        const text = cleanArticleText(await fetchViaNative(url) || '');
        if (text && text.length >= 40) return { text, via: '原生直连' };
        nativeErr = new Error('原生直连读取到的内容为空或过短');
      } catch (e) {
        nativeErr = e;
      }
    }

    // 路径 2：公共代理兜底（网页版 / 原生直连失败时）
    let lastErr = null;
    for (const proxy of ARTICLE_PROXIES) {
      try {
        const raw = await fetchWithTimeout(proxy.build(url), 15000);
        const text = cleanArticleText(proxy.parse(raw) || '');
        if (text && text.length >= 40) {
          // 原生环境下降级到代理，如实标注，避免「原生直连」卖点落空却不自知
          const via = nativeErr ? ('公共代理（原生直连失败：' + (nativeErr.message || '未知错误') + '）') : proxy.name;
          return { text, via, degraded: !!nativeErr };
        }
        lastErr = new Error('读取到的内容为空或过短');
      } catch (e) { lastErr = e; }
    }
    const hint = nativeErr ? '原生直连与公共代理均失败（' + (nativeErr.message || '') + '）。' : '网络受限或文章需登录。';
    throw new Error('读取失败：' + hint + '请打开文章复制正文粘贴到下方。（' + (lastErr && lastErr.message ? lastErr.message : '未知错误') + '）');
  }

  global.TodoFiles = { parseFile, parsePDF, parseDOCX, parseTXT, cleanArticleText, fetchArticle, looksLikeWechatArticle, isNative };
})(typeof window !== 'undefined' ? window : globalThis);
