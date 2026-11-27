/* ============================================================
 * 聊吧待办 · 聊天文本待办提取引擎
 * 纯前端规则引擎，无需联网 / API Key，数据不出本机
 * ============================================================ */
(function (global) {
  'use strict';

  // ---------- 通用工具 ----------
  const CN_NUM = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
  const WEEK_MAP = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };

  function cnToNum(s) {
    if (!s) return NaN;
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    if (CN_NUM[s] !== undefined) return CN_NUM[s];
    if (s.indexOf('十') !== -1) {
      const [a, b] = s.split('十');
      return (a ? (CN_NUM[a] || parseInt(a, 10)) : 1) * 10 + (b ? (CN_NUM[b] || 0) : 0);
    }
    return NaN;
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtDate(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

  // ---------- 强任务信号词 ----------
  const STRONG_SIGNALS = [
    '记得', '记一下', '记着', '别忘', '不要忘', '提醒', '帮我', '帮忙', '麻烦',
    '需要做', '需要', '得去', '必须', '尽快', '赶紧', '抓紧', 'asap', '急',
    '截止', 'deadline', '提交', '交给', '发给', '发我', '给我', '安排', '预约',
    '订一下', '订个', '准备', '搞定', '处理一下', '跟进', '确认一下', '整理一下',
    '开个会', '开会', '回复', '联系', '催一下', '签', '报销', '交一下',
    'please', 'remember', 'submit', 'reminder', 'don t forget', 'make sure'
  ];
  const ACTION_WORDS = [
    '发', '交', '提交', '订', '买', '做', '写', '整理', '准备', '确认', '联系',
    '回复', '安排', '开', '见', '签', '报销', '跟进', '改', '检查', '审核',
    '完成', '处理', '收集', '汇总', '汇报', '通知', '提醒', '预约', '寄', '取'
  ];
  const NEGATIVE_PATTERNS = [
    /^(你好|在吗|收到|好的|谢谢|哈哈| ok|okay|嗯+|哦+|啊+|？|\?|！|!)+$/i,
    /^(怎么|为什么|what|why|是不是|有没有|能不能|要不要|可以吗|行不行).{0,12}[？?]$/
  ];

  // ---------- 消息拆分与清洗 ----------
  function parseMessages(text) {
    if (!text || !text.trim()) return [];
    const rawLines = text.replace(/\r/g, '').split('\n');
    const messages = [];
    let currentSpeaker = '';

    for (let line of rawLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // 格式1: "小明 10:23" 或 "小明 上午10:23" —— 仅说话人+时间
      const speakerTime = trimmed.match(/^(.{1,20}?)\s+((?:上午|下午|晚上|中午)?\s*\d{1,2}:\d{2}(?::\d{2})?)$/);
      if (speakerTime) {
        currentSpeaker = speakerTime[1].trim();
        continue;
      }
      // 格式2: "小明：内容" 或 "小明: 内容"
      const speakerColon = trimmed.match(/^(.{1,20}?)[：:]\s*(.+)$/);
      if (speakerColon && speakerColon[2].trim().length > 0) {
        currentSpeaker = speakerColon[1].trim();
        messages.push({ speaker: currentSpeaker, text: speakerColon[2].trim() });
        continue;
      }
      // 格式3: 纯时间行 "10:23"
      if (/^((?:上午|下午|晚上|中午)?\s*\d{1,2}:\d{2}(?::\d{2})?)$/.test(trimmed)) continue;

      // 去掉行首残留时间
      let content = trimmed.replace(/^((?:上午|下午|晚上|中午)?\s*\d{1,2}:\d{2}(?::\d{2})?)\s*/, '');
      // 仅去掉明确的中括号/圆括号前缀，如「[图片] 内容」
      content = content.replace(/^[\[\(][^\[\]\(\)]{1,10}[\]\)]\s*/, '').trim();
      if (!content) continue;

      // 一行含多个任务时用序号或分号拆分
      const parts = content.split(/(?=(?:^|[；;])\s*(?:\d+[\.、)]|[一二三四五六七八九十]+[\.、)])|[；;])/)
        .map(p => p.replace(/^[；;、]\s*/, '').replace(/^\d+[\.、)]\s*/, '').trim())
        .filter(p => p.length >= 3);

      if (parts.length > 1) {
        parts.forEach(p => messages.push({ speaker: currentSpeaker, text: p }));
      } else {
        messages.push({ speaker: currentSpeaker, text: content });
      }
    }
    return messages;
  }

  // ---------- 时间解析 ----------
  function parseDeadline(text) {
    const now = new Date();
    let date = null;
    let timeStr = '';
    let matched = '';

    // 具体日期: 11月28日 / 11月28号 / 28号
    let m = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/);
    if (m) {
      const month = parseInt(m[1]), day = parseInt(m[2]);
      // 校验月份/日期合法性，避免 new Date 自动进位把 13月40日「合法化」
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const candidate = new Date(now.getFullYear(), month - 1, day);
        if (candidate.getMonth() === month - 1 && candidate.getDate() === day) {
          date = candidate;
          if (date < startOfToday()) date.setFullYear(date.getFullYear() + 1);
          matched = m[0];
        }
      }
    }
    // X号 (无月份)
    if (!date) {
      m = text.match(/(\d{1,2})\s*号(?!码)/);
      if (m) {
        const day = parseInt(m[1]);
        if (day >= 1 && day <= 31) {
          date = new Date(now.getFullYear(), now.getMonth(), day);
          if (date < startOfToday()) date.setMonth(date.getMonth() + 1);
          matched = m[0];
        }
      }
    }
    // 相对日期
    if (!date) {
      const dayOffset = { '大后天': 3, '今天': 0, '今日': 0, '今晚': 0, '明天': 1, '明日': 1, '明早': 1, '后天': 2 };
      // 按长度降序遍历，确保「大后天」不会被更短的「后天」抢先命中
      for (const key of Object.keys(dayOffset).sort((a, b) => b.length - a.length)) {
        if (text.includes(key)) {
          date = startOfToday();
          date.setDate(date.getDate() + dayOffset[key]);
          matched = key;
          break;
        }
      }
    }
    // 下周X / 周X / 星期X
    if (!date) {
      m = text.match(/((?:下|这)*)\s*(?:周|星期|礼拜)\s*([一二三四五六日天1-7])/);
      if (m) {
        // 「一下周五」「两下周」里的「下」属于「一下」，不是「下周」
        let prefix = m[1];
        if (/下/.test(prefix) && m.index > 0 && /[一两]/.test(text[m.index - 1])) {
          prefix = prefix.replace(/下+$/, '');
          matched = m[0].replace(/^下/, '');
        } else {
          matched = m[0];
        }
        const target = WEEK_MAP[m[2]] || parseInt(m[2]);
        const base = startOfToday();
        const curDay = base.getDay() || 7;
        let diff = target - curDay;
        // 支持「下下周X」= 再往后一周（每个「下」加 7 天）
        const downCount = (prefix.match(/下/g) || []).length;
        if (downCount > 0) diff += 7 * downCount;
        else if (diff < 0) diff += 7;
        base.setDate(base.getDate() + diff);
        date = base;
      }
    }
    // 时间 HH:MM 或 X点
    let m2 = text.match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
    if (m2) {
      timeStr = `${pad(+m2[1])}:${pad(+m2[2])}`;
      matched += (matched ? ' ' : '') + m2[0];
    } else {
      m2 = text.match(/(上午|下午|晚上|中午|早上)?\s*(\d{1,2}|[一二两三四五六七八九十]{1,3})\s*点(半|\d{1,2}分?)?/);
      if (m2) {
        let h = cnToNum(m2[2]);
        if (isNaN(h)) h = 0;
        const period = m2[1];
        if ((period === '下午' || period === '晚上') && h < 12) h += 12;
        if (period === '中午' && h < 11) h += 12;
        let min = 0;
        if (m2[3] === '半') min = 30;
        else if (m2[3]) min = parseInt(m2[3]) || 0;
        timeStr = `${pad(h)}:${pad(min)}`;
        matched += (matched ? ' ' : '') + m2[0];
      }
    }

    if (!date && !timeStr) return null;

    // 若只有时间没有日期，默认今天
    if (!date) {
      date = startOfToday();
      const [h, min] = timeStr.split(':').map(Number);
      const t = new Date(date); t.setHours(h, min, 0, 0);
      if (t < now) date.setDate(date.getDate() + 1);
      matched = timeStr;
    }

    const [h, min] = timeStr ? timeStr.split(':').map(Number) : [23, 59];
    date.setHours(h, min, 0, 0);

    // 去掉 "之前/前/截止" 这类修饰词对显示的干扰，保留核心日期
    const hasBefore = /之前|以前|前|截止|deadline/i.test(text);
    const display = (timeStr ? `${fmtDate(date)} ${timeStr}` : fmtDate(date)) + (hasBefore ? ' 前' : '');

    return { display, time: date.getTime(), raw: matched.trim() };
  }

  // ---------- 负责人提取 ----------
  // 过滤误吞的介词/代词，如「让小张」应为「小张」、「麻烦你」不是人名
  function validAssignee(name, speaker) {
    if (!name || name === speaker) return false;
    if (/^(?:麻烦|请|让|叫|跟|帮|你|我|他|她|它|大家|各位|提醒|记得|一下)/.test(name)) return false;
    // 介词短语不是人名，如「请在会议室提交」不应把「在会议室」当负责人
    if (/^(?:在|到|去|给|把|对|向|从)/.test(name)) return false;
    if (/你$/.test(name)) return false;
    return true;
  }
  function parseAssignee(text, speaker) {
    // 1. @ 明确点名，优先级最高
    let m = text.match(/@([\u4e00-\u9fa5A-Za-z0-9_]{1,12})/);
    if (m) return m[1];
    // 2. 「让/叫/请/跟 XX 记得/把/去…」——去掉正则末尾多余的空格，并校验边界
    m = text.match(/(?:让|叫|请|跟)\s*([\u4e00-\u9fa5]{2,4}?)(?=\s*(?:记得|记一下|记着|帮我|把|去|今天|明天|后天|周|确认|提交|发|订|准备|处理|整理))/);
    if (m && validAssignee(m[1], speaker)) return m[1];
    // 3. 「XX你记得…」「XX 记得…」——非贪婪匹配，把「你」当分隔符而非名字的一部分
    const re = /([\u4e00-\u9fa5]{2,4}?)\s*(?:你\s*)?(?:记得|记一下|记着|麻烦你)/g;
    let hit;
    while ((hit = re.exec(text)) !== null) {
      if (validAssignee(hit[1], speaker)) return hit[1];
    }
    return '';
  }

  // ---------- 优先级 ----------
  function parsePriority(text) {
    const high = /紧急|很急|急急|尽快|赶紧|抓紧|asap|马上|立刻|立即|fire|重要|优先|今天内|今日内|下班前/i;
    return high.test(text) ? 'high' : 'normal';
  }

  // ---------- 地点解析 ----------
  function parseLocation(text) {
    // 「在XX开会/见/碰头」中的 XX
    let m = text.match(/在([\u4e00-\u9fa5A-Za-z0-9·]{2,20}?)(?=开会|见面|碰头|集合|等|见|开|举行|进行|碰面|相聚|会面|提交|交|发|签|处理|确认|整理|汇报|讨论|审批)/);
    if (m && !/^(一起|这里|那里|一起|网上|线上|家|公司|路上|一起)$/.test(m[1])) return m[1];
    // 「地点：XX」/「地址：XX」
    m = text.match(/(?:地点|地址|位置)[:：]\s*([\u4e00-\u9fa5A-Za-z0-9·\s]{2,30})/);
    if (m) return m[1].trim().replace(/[，,。;；].*$/, '');
    // 「去XX」/「到XX」（后接动作或句末）
    // 关键：遇到「的」立即停止，避免把「去上海的机票」整段当成地点（机票是宾语不是地点）
    m = text.match(/(?:去|到)([\u4e00-\u9fa5A-Za-z0-9·]{2,15}?)(?=的|开会|见面|见|取|拿|办|处理|集合|一趟|一下|[，,。]|$)/);
    if (m && !/^(那边|这里|那里|一下|一趟)$/.test(m[1])) return m[1];
    return '';
  }

  // ---------- 内容清洗 ----------
  function cleanContent(text, deadlineRaw) {
    let c = text;
    // 循环去掉开头触发词（支持「请记得」「请帮我」等组合）
    const triggerRe = /^(请|记得|记一下|记着|帮我|帮忙|麻烦你|麻烦|提醒我|提醒|需要|得|要|必须)\s*/;
    let prev;
    do { prev = c; c = c.replace(triggerRe, ''); } while (c !== prev);
    // 去掉开头时间状语（允许原文中存在/省略空格）
    if (deadlineRaw) {
      const escaped = deadlineRaw.replace(/\s+/g, '').split('').map(ch =>
        ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*'
      ).join('');
      c = c.replace(new RegExp(escaped, 'i'), '');
    }
    c = c.replace(/^(在|于|的)?\s*(今天|明天|后天|下周.{0,2}|周.{1,2}|星期.{1,2}|\d{1,2}月\d{1,2}[日号]?|\d{1,2}号)\s*(上午|下午|晚上|中午|早上)?\s*(\d{1,2}[:：]\d{2}|\d{1,2}点半?|\d{1,2}点)?\s*(之前|前|以前)?\s*/, '');
    c = c.replace(/[,，、\s]+(尽快|赶紧|抓紧|急|asap|很重要|重要)\s*[,，。.]*$/i, '');
    c = c.replace(/^[，,、\s]+|[，,、\s]+$/g, '');
    // 去掉开头残留的时间修饰词，并再次清理可能暴露的触发词
    c = c.replace(/^(之前|以前|前|截止|deadline)\s*/i, '');
    do { prev = c; c = c.replace(triggerRe, ''); } while (c !== prev);
    c = c.replace(/[。!！]+$/, '');
    // 去掉 @负责人
    c = c.replace(/@[\u4e00-\u9fa5A-Za-z0-9_]+\s*/g, '');
    // 不再回退原文：像「记得明天」这种纯时间语句清洗后为空，不应把原文当成正文
    return c.trim();
  }

  // ---------- 判断是否包含待办 ----------
  function isTodoMessage(text) {
    if (text.length < 4) return false;
    if (NEGATIVE_PATTERNS.some(p => p.test(text.trim()))) return false;

    // 强信号词
    if (STRONG_SIGNALS.some(w => text.includes(w))) return true;
    // 动作词 + 时间词
    const hasAction = ACTION_WORDS.some(w => text.includes(w));
    const hasTime = /今天|明天|后天|周|月|\d+号|点|之前|截止|deadline/i.test(text);
    if (hasAction && hasTime) return true;
    // 句末是任务指令
    if (/(把|将).+?(发|交|给|提交|整理|准备|确认|完成|处理)/.test(text)) return true;
    return false;
  }

  // ---------- 主提取函数 ----------
  function extractTodos(text, source) {
    const messages = parseMessages(text);
    const todos = [];
    const seen = new Set();

    messages.forEach((msg, idx) => {
      const content = msg.text;
      if (!isTodoMessage(content)) return;

      const deadline = parseDeadline(content);
      const assignee = parseAssignee(content, msg.speaker);
      const priority = parsePriority(content);
      const location = parseLocation(content);
      let clean = cleanContent(content, deadline ? deadline.raw : '');
      // 从内容里去掉地点状语，保持任务描述干净
      if (location && clean) {
        const locRe = new RegExp('(在|去|到)?' + location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), '');
        clean = clean.replace(locRe, '').replace(/^[，,、\s]+|[，,、\s]+$/g, '').trim() || clean;
      }
      // 纯时间语句（如「记得明天」）清洗后正文为空，不构成有效待办，直接跳过
      if (!clean) return;

      // 去重
      const key = clean.slice(0, 20);
      if (seen.has(key)) return;
      seen.add(key);

      todos.push({
        id: 'todo_' + Date.now() + '_' + idx,
        content: clean,
        deadline: deadline ? deadline.display : '',
        deadlineTime: deadline ? deadline.time : null,
        assignee,
        location,
        source: source || '其他',
        speaker: msg.speaker || '',
        priority,
        done: false,
        createdAt: Date.now()
      });
    });

    // 紧急优先、有截止时间优先
    todos.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority === 'high' ? -1 : 1;
      if (a.deadlineTime && b.deadlineTime) return a.deadlineTime - b.deadlineTime;
      if (a.deadlineTime) return -1;
      if (b.deadlineTime) return 1;
      return 0;
    });

    return todos;
  }

  global.ExtractionEngine = { extractTodos, parseMessages, parseDeadline, parsePriority, parseLocation };
})(typeof window !== 'undefined' ? window : globalThis);
