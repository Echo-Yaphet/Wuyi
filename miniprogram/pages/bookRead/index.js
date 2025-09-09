// miniprogram/pages/bookRead/index.js

const app = getApp();

// =============== 配置区（仅需改这里） ===============
const BASE = (app && app.globalData && app.globalData.API_BASE) || ''; // 例如: https://api.example.com

// 可能的接口候选（会按顺序尝试直到成功）
const API = {
  bookDetail: (bookId) => [
    `${BASE}/api/books/${bookId}`,                 // 文档风格一
    `${BASE}/api/book/${bookId}`,                  // 文档风格二
    `${BASE}/books/${bookId}`,                     // 备选
    `${BASE}/api/book/detail?id=${encodeURIComponent(bookId)}` // 备选
  ],
  chapterList: (bookId) => [
    `${BASE}/api/books/${bookId}/chapters`,
    `${BASE}/api/book/${bookId}/chapters`,
    `${BASE}/api/chapters?bookId=${encodeURIComponent(bookId)}`,
    `${BASE}/chapters?bookId=${encodeURIComponent(bookId)}`
  ],
  chapterContent: (bookId, chapterId) => [
    `${BASE}/api/books/${bookId}/chapters/${chapterId}`,
    `${BASE}/api/chapters/${chapterId}`,
    `${BASE}/api/chapter/${chapterId}`,
    `${BASE}/api/chapter/detail?id=${encodeURIComponent(chapterId)}`
  ],
  // 可选：上报阅读历史（如果后端支持就打开; 不支持会静默失败）
  reportHistory: () => [
    `${BASE}/api/history/log`,
    `${BASE}/api/read/log`,
    `${BASE}/history/log`
  ]
};

// =============== 工具函数 ===============
function wxRequestJSON(url, { method = 'GET', data = {}, timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url, method, data, timeout,
      success: (res) => {
        // 兼容不同后端包装：{code:0,data:{}} / {success:true,data:{}} / 直接对象
        const statusOK = (res.statusCode >= 200 && res.statusCode < 300);
        if (!statusOK) return reject(new Error(`HTTP ${res.statusCode}`));
        const body = res.data;
        if (body && typeof body === 'object') {
          if ('data' in body) return resolve(body.data);
          if ('result' in body) return resolve(body.result);
          if ('content' in body) return resolve(body.content);
          return resolve(body); // 直接就是数据
        }
        resolve(body);
      },
      fail: reject
    });
  });
}

async function tryRequest(candidates, opts) {
  let lastErr;
  for (const u of candidates) {
    try {
      const data = await wxRequestJSON(u, opts);
      return { ok: true, url: u, data };
    } catch (e) {
      lastErr = e;
      // 继续尝试下一个候选
    }
  }
  return { ok: false, err: lastErr };
}

// 从数据中安全提取字段
function pick(obj, pathArr, fallback = undefined) {
  for (const p of pathArr) {
    const v = p.split('.').reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), obj);
    if (v !== undefined && v !== null) return v;
  }
  return fallback;
}

// 归一化：书籍详情
function normalizeBookDetail(raw) {
  return {
    id: pick(raw, ['id', '_id', 'bookId', 'uuid'], ''),
    title: pick(raw, ['title', 'name'], '未命名'),
    author: pick(raw, ['author'], ''),
    dynasty: pick(raw, ['dynasty', 'era'], ''),
    coverUrl: pick(raw, ['cover', 'coverUrl', 'cover_url', 'thumb'], ''),
    desc: pick(raw, ['desc', 'description', 'intro', 'abstract'], '')
  };
}

// 归一化：目录
function normalizeChapterList(raw) {
  // 可能是 {list: []} / {items: []} / [] 结构
  const arr = Array.isArray(raw) ? raw
    : Array.isArray(raw?.list) ? raw.list
    : Array.isArray(raw?.items) ? raw.items
    : [];

  return arr.map((it, idx) => ({
    id: pick(it, ['id', '_id', 'chapterId', 'uuid'], String(idx + 1)),
    title: pick(it, ['title', 'name'], `第${idx + 1}章`),
    order: pick(it, ['order', 'index', 'seq'], idx)
  })).sort((a, b) => (a.order || 0) - (b.order || 0));
}

// 归一化：章节内容
function normalizeChapterContent(raw) {
  // 可能是 {content: "..."} / {text: "..."} / {paragraphs: ["",""]} 等
  const content = pick(raw, ['content', 'text', 'body'], '');
  const paragraphs = Array.isArray(raw?.paragraphs) ? raw.paragraphs
                     : content ? String(content).split(/\n+/) : [];
  return {
    content: paragraphs.join('\n\n') || content || '（本章暂无内容）'
  };
}

// 轻量节流：防止频繁点击换章
let _navLock = false;

// =============== 页面逻辑 ===============
Page({
  data: {
    // --- 原有数据保持 ---
    bookId: '',
    book: null,
    chapters: [],
    currentChapterId: '',
    currentChapterIndex: 0,
    chapterContent: '',
    loading: false,
    // 其它已有的 UI 状态保持不变...
  },

  onLoad(options) {
    const bookId = options?.id || options?.bookId || '';
    const chapterId = options?.chapterId || '';
    if (!bookId) {
      wx.showToast({ title: '缺少 bookId', icon: 'none' });
      return;
    }
    this.setData({ bookId });

    // 并行拉取：书籍详情 + 目录
    this.bootstrap(bookId, chapterId);
  },

  async bootstrap(bookId, preferredChapterId) {
    try {
      wx.showLoading({ title: '加载中' });
      this.setData({ loading: true });

      // 1) 详情
      const detailRes = await tryRequest(API.bookDetail(bookId), { method: 'GET' });
      if (!detailRes.ok) throw detailRes.err || new Error('书籍详情获取失败');
      const book = normalizeBookDetail(detailRes.data);
      this.setData({ book });

      // 2) 目录
      const listRes = await tryRequest(API.chapterList(bookId), { method: 'GET' });
      if (!listRes.ok) throw listRes.err || new Error('目录获取失败');
      const chapters = normalizeChapterList(listRes.data);
      this.setData({ chapters });

      // 3) 确定初始章节
      let useChapterId = preferredChapterId;
      if (!useChapterId && chapters.length) {
        // 可尝试从本地最近阅读恢复
        const lastKey = `wm_read_last_${bookId}`;
        useChapterId = wx.getStorageSync(lastKey) || chapters[0].id;
      }

      if (useChapterId) {
        const idx = Math.max(0, chapters.findIndex(c => String(c.id) === String(useChapterId)));
        await this.loadChapterByIndex(idx);
      }
    } catch (e) {
      console.error(e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ loading: false });
    }
  },

  // 拉取指定下标章节
  async loadChapterByIndex(index) {
    const { chapters, bookId } = this.data;
    if (!chapters.length) return;
    const clamped = Math.max(0, Math.min(index, chapters.length - 1));
    const chapter = chapters[clamped];
    await this.loadChapterContent(bookId, chapter.id);
    this.setData({
      currentChapterId: chapter.id,
      currentChapterIndex: clamped
    });
    // 记住最近阅读
    wx.setStorageSync(`wm_read_last_${bookId}`, chapter.id);
    // 可选：上报阅读历史（失败也不影响）
    this._reportHistorySafe(bookId, chapter.id).catch(() => {});
  },

  // 获取章节内容
  async loadChapterContent(bookId, chapterId) {
    try {
      wx.showNavigationBarLoading();
      const res = await tryRequest(API.chapterContent(bookId, chapterId), { method: 'GET' });
      if (!res.ok) throw res.err || new Error('章节内容获取失败');
      const { content } = normalizeChapterContent(res.data);
      this.setData({ chapterContent: content });
    } catch (e) {
      console.error(e);
      wx.showToast({ title: '章节加载失败', icon: 'none' });
      this.setData({ chapterContent: '（本章内容加载失败）' });
    } finally {
      wx.hideNavigationBarLoading();
    }
  },

  // 上一章
  onPrevChapter() {
    if (_navLock) return;
    _navLock = true;
    const idx = this.data.currentChapterIndex - 1;
    this.loadChapterByIndex(idx).finally(() => {
      setTimeout(() => (_navLock = false), 300);
    });
  },

  // 下一章
  onNextChapter() {
    if (_navLock) return;
    _navLock = true;
    const idx = this.data.currentChapterIndex + 1;
    this.loadChapterByIndex(idx).finally(() => {
      setTimeout(() => (_navLock = false), 300);
    });
  },

  // 目录点选（原有绑定的事件名保持不变）
  onPickChapter(e) {
    const { id, index } = e.currentTarget.dataset || {};
    const idx = (index !== undefined) ? Number(index) : this.data.chapters.findIndex(c => String(c.id) === String(id));
    if (idx >= 0) this.loadChapterByIndex(idx);
  },

  // 可选：上报阅读历史（若后端存在 /api/history/log）
  async _reportHistorySafe(bookId, chapterId) {
    const candidates = API.reportHistory();
    try {
      await tryRequest(candidates, {
        method: 'POST',
        data: { bookId, chapterId }  // 如果后端需要更多字段（如 userId / progress），在此补充
      });
    } catch (_) {
      // 静默忽略
    }
  }
});