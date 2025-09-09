// pages/knowledgeGraph/index.js
const echarts = require('../../assets/ec-canvas/echarts'); // ECharts 适配版
const WxParse = require('../../wxParse/wxParse.js'); // wxParse（已扩展 wxParseReturn）
// 通用实体类型的显示名与颜色
const TYPE_LABELS = {
  PERSON: '人物',
  ORGANIZATION: '机构',
  EVENT: '事件',
  PLACE: '地点',
  WORK: '著作',
  OTHER: '其他'
};

const TYPE_COLORS = {
  PERSON: '#E86A5A',
  ORGANIZATION: '#4D89F7',
  EVENT: '#F6B23E',
  PLACE: '#60C07C',
  WORK: '#9D7BF7',
  OTHER: '#9AA0A6'
};

function normalizeType(t) {
  if (!t) return 'OTHER';
  const up = String(t).toUpperCase().trim();
  return TYPE_LABELS[up] ? up : 'OTHER';
}
Page({
  data: {
    /* ===== 图谱（保持你的默认值） ===== */
    kgScaleValue: 1,
    kgScaleMin: 1,
    kgScaleMax: 3,
    kgStep: 0.2,
    kgX: 0,
    kgY: 0,
    _zoomLock: false,

    /* ===== 会话与聊天 ===== */
    sessions: [],
    activeSessionId: '',
    messages: [],
    status: 'idle',
    inputValue: '',
    canSend: true,
    scrollToId: '',

    /* 抽屉 */
    showSider: false,

    /* ECharts 懒加载 */
    ec: {
      lazyLoad: true
    },

    /* 知识图谱服务地址（本地默认） */
    KG_GRAPH_BASE: 'http://127.0.0.1:8800'
  },

  onLoad() {
    this.kgCurrentScale = 1;

    // 读取缓存会话
    const cache = wx.getStorageSync('wm_kg_sessions') || [];
    if (cache.length) {
      const sid = cache[0].id;
      const msgs = (cache[0].messages || []).map(m => this._withParsed(m));
      this.setData({
        sessions: cache,
        activeSessionId: sid,
        messages: msgs
      }, () => {
        this._ensureWelcome(); // 保证欢迎语存在
      });
    } else {
      const sid = this._createInitialSession(cache);
      const s = wx.getStorageSync('wm_kg_sessions')[0];
      const msgs = (s.messages || []).map(m => this._withParsed(m));
      this.setData({
        sessions: wx.getStorageSync('wm_kg_sessions'),
        activeSessionId: sid,
        messages: msgs
      }, () => {
        this._ensureWelcome();
      });
    }

    // 初始化图表并拉默认图
    this._ensureKGReady().then(() => {
      this.fetchGraphByName('');
    });
  },

  /* ========== 抽屉 ========== */
  toggleSider() {
    this.setData({
      showSider: !this.data.showSider
    })
  },
  hideSider() {
    this.setData({
      showSider: false
    })
  },

  /* ========== Markdown 解析 ========== */
  _withParsed(msg) {
    if (msg.role !== 'ai') return msg;
    const md = (msg.display || msg.text || '').trim();
    let nodes = [];
    try {
      nodes = WxParse.wxParseReturn(md);
    } catch (e) {}
    return {
      ...msg,
      parsed: {
        nodes
      }
    };
  },

  /* ========== 知识图谱：ECharts 初始化 / 渲染 / 点击 ========== */
  _ensureKGReady() {
    if (this._kgChartReady) return Promise.resolve(this._kgChart);
    const comp = this.selectComponent('#kg-ec');
    return new Promise((resolve, reject) => {
      comp.init((canvas, width, height, dpr) => {
        // 这里的 canvas 必须有 addEventListener、setChart
        console.log('init canvas polyfills:',
          typeof canvas.addEventListener,
          typeof canvas.setChart); // 应分别是 'function', 'function'

        const chart = echarts.init(canvas, null, {
          width,
          height,
          devicePixelRatio: dpr
        });
        canvas.setChart(chart); // ⭐ 这句很关键
        this._kgChart = chart;
        this._kgChartReady = true;
        resolve(chart);
        return chart;
      });
    });
  },

  fetchGraphByName(name) {
    const url = `${this.data.KG_GRAPH_BASE}/query-node?name=${encodeURIComponent(name || 'any')}`;
    wx.request({
      url,
      method: 'GET',
      success: (res) => {
        try {
          const data = res.data || {};
          if (data && data.found === false) {
            wx.showToast({ title: '未找到该节点，显示默认图', icon: 'none' });
          }
          this._ensureKGReady().then(chart => {
            chart.setOption(this._buildGraphOption(data), true);
          });
        } catch (e) {
          this._showKGError('图谱数据异常');
        }
      },
      fail: (err) => {
        console.error('KG request fail:', err);
        this._showKGError('图谱服务不可用');
      }
    })
  },

  _buildGraphOption(apiData) {
    // apiData 结构：{ found, source:{name,type,description}, targets:[{description, target_entity:{...}}] }
    const src = apiData?.source || {};
    const tgs = Array.isArray(apiData?.targets) ? apiData.targets : [];
  
    // 1) 收集类型，生成 legend 与 categories
    const types = new Set();
    const allEntities = [];
  
    const sourceType = normalizeType(src.type);
    types.add(sourceType);
    allEntities.push({ ...src, _isSource: true });
  
    tgs.forEach(rel => {
      const te = rel?.target_entity || {};
      const ty = normalizeType(te.type);
      types.add(ty);
      allEntities.push(te);
    });
  
    const typeList = Array.from(types);
    const categories = typeList.map(t => ({
      name: TYPE_LABELS[t],
      itemStyle: { color: TYPE_COLORS[t] || TYPE_COLORS.OTHER }
    }));
  
    const typeToCategoryIndex = {};
    typeList.forEach((t, i) => (typeToCategoryIndex[t] = i));
  
    // 2) 构建节点（按度数计算大小）
    const degree = {};
    allEntities.forEach(e => {
      const key = e.name || '';
      degree[key] = (degree[key] || 0) + 0; // 初始化
    });
    tgs.forEach(rel => {
      const te = rel?.target_entity || {};
      degree[src.name] = (degree[src.name] || 0) + 1;
      degree[te.name] = (degree[te.name] || 0) + 1;
    });
  
    const nodes = [];
    // 去重
    const seen = new Set();
    allEntities.forEach(e => {
      const key = e.name;
      if (!key || seen.has(key)) return;
      seen.add(key);
  
      const ty = normalizeType(e.type);
      const catIndex = typeToCategoryIndex[ty] ?? 0;
      const deg = degree[key] || 1;
      const size = Math.max(20, Math.min(60, 12 + deg * 6));
  
      nodes.push({
        id: key,
        name: key,
        value: e.description || '',
        category: catIndex,
        symbolSize: size,
        itemStyle: { color: categories[catIndex].itemStyle.color },
        label: { show: true, formatter: '{b}', fontSize: 12 },
        _raw: e // 点击时要用
      });
    });
  
    // 3) 边
    const edges = tgs.map(rel => {
      const te = rel?.target_entity || {};
      return {
        source: src.name,
        target: te.name,
        value: rel?.description || '',
        label: { show: !!rel?.description, formatter: '{c}', fontSize: 10 }
      };
    });
  
    // 4) ECharts option
    return {
      tooltip: {
        formatter: p => {
          if (p.dataType === 'node') {
            const e = p.data._raw || {};
            const ty = normalizeType(e.type);
            return `<div style="max-width:220px;white-space:normal;">
              <div><b>${p.data.name}</b>（${TYPE_LABELS[ty]}）</div>
              <div style="margin-top:4px;color:#666;">${(e.description || '').slice(0,180)}</div>
            </div>`;
          } else if (p.dataType === 'edge') {
            return p.data.value || '';
          }
          return '';
        }
      },
      legend: [{
        data: categories.map(c => c.name),
        orient: 'horizontal',
        bottom: 0
      }],
      series: [{
        type: 'graph',
        layout: 'force',
        data: nodes,
        links: edges,
        categories,
        roam: true,
        zoom: 1,
        draggable: true,
        label: { position: 'right' },
        edgeSymbol: ['none','arrow'],
        edgeSymbolSize: 8,
        force: { repulsion: 300, edgeLength: 120, friction: 0.2 },
        lineStyle: { width: 1, opacity: 0.7, curveness: 0.1 }
      }]
    };
  },

  _bindKGClick() {
    if (!this.kgChart) return;
    this.kgChart.off('click');
    this.kgChart.on('click', (params) => {
      if (params.dataType !== 'node') return;
  
      // 后端节点数据存在 _raw
      const ent = params.data?._raw;
      if (!ent) return;
  
      // 类型中文名（用 normalizeType + TYPE_LABELS）
      const ty = normalizeType(ent.type);
      const tyLabel = TYPE_LABELS[ty] || '实体';
  
      // 动态生成提示词
      const prompt = `请结合吴门医派相关知识，围绕【${tyLabel}：${ent.name}】进行专业解读。
  可参考方向：历史背景、学术贡献、经典论述、与吴门医派的关系。
  背景摘要：${(ent.description || '').slice(0,120)}…`;
  
      // 填入输入框（如果想直接发送，可调用 this._send(prompt)）
      this.setData({
        inputValue: prompt,
        canSend: true
      });
    });
  },

  _showKGError(msg) {
    this._ensureKGReady().then(chart => {
      chart.clear();
      chart.setOption({
        title: {
          text: msg || '图谱服务不可用',
          left: 'center',
          top: 'middle'
        }
      }, true);
    });
  },

  /* ========== 知识图谱缩放（保留你的实现） ========== */
  onKgScale(e) {
    this.kgCurrentScale = e.detail.scale || this.kgCurrentScale
  },
  _clampAndSnap(val) {
    const {
      kgScaleMin,
      kgScaleMax,
      kgStep
    } = this.data;
    const c = Math.max(kgScaleMin, Math.min(kgScaleMax, val));
    const s = Math.round(c / kgStep) * kgStep;
    return Number(s.toFixed(4));
  },
  _withZoomLock(fn) {
    if (this.data._zoomLock) return;
    this.setData({
      _zoomLock: true
    });
    try {
      fn()
    } finally {
      setTimeout(() => this.setData({
        _zoomLock: false
      }), 120)
    }
  },
  zoomIn() {
    this._withZoomLock(() => {
      const n = this._clampAndSnap(this.kgCurrentScale + this.data.kgStep);
      if (n > this.kgCurrentScale) {
        this.kgCurrentScale = n;
        this.setData({
          kgScaleValue: n
        })
      } else if (this.kgCurrentScale >= this.data.kgScaleMax - 1e-6) {
        wx.showToast({
          title: '已放大到最大',
          icon: 'none'
        })
      }
    })
  },
  zoomOut() {
    this._withZoomLock(() => {
      const n = this._clampAndSnap(this.kgCurrentScale - this.data.kgStep);
      if (n < this.kgCurrentScale) {
        this.kgCurrentScale = n;
        this.setData({
          kgScaleValue: n
        })
      } else if (this.kgCurrentScale <= this.data.kgScaleMin + 1e-6) {
        wx.showToast({
          title: '已缩小到最小',
          icon: 'none'
        })
      }
    })
  },
  resetKG() {
    this.kgCurrentScale = 1;
    this.setData({
      kgScaleValue: 1,
      kgX: 0,
      kgY: 0
    })
  },

  /* ========== 会话管理（仅加 _ensureWelcome） ========== */
  _ensureWelcome() {
    const sessions = this.data.sessions.slice();
    const s = sessions.find(x => x.id === this.data.activeSessionId);
    if (!s) return;
    const hasWelcome = (s.messages || []).some(m => m.role === 'ai' && /AI助手/.test(m.text || ''));
    if (!hasWelcome) {
      const welcome = {
        id: Date.now(),
        role: 'ai',
        text: '您好，我是基于吴门医派知识的AI助手，请问有什么可以帮您？',
        time: this._time()
      };
      s.messages = [welcome, ...(s.messages || [])];
      s.updatedAt = Date.now();
      this._saveSessions(sessions, this.data.activeSessionId, s.messages.map(m => this._withParsed(m)));
    }
  },

  onNewSession() {
    const sessions = this.data.sessions.slice();
    const id = Date.now().toString(36);
    const title = '新的会话';
    const welcome = {
      id: Date.now(),
      role: 'ai',
      text: '您好，我是基于吴门医派知识的AI助手，请问有什么可以帮您？',
      time: this._time()
    };
    sessions.unshift({
      id,
      title,
      updatedAt: Date.now(),
      messages: [welcome]
    });
    this._saveSessions(sessions, id, [this._withParsed(welcome)]);
  },

  onPickSession(e) {
    const id = e.currentTarget.dataset.id;
    const s = this.data.sessions.find(x => x.id === id);
    if (!s) return;
    const msgs = (s.messages || []).map(m => this._withParsed(m));
    this.setData({
      activeSessionId: id,
      messages: msgs,
      scrollToId: ''
    });
    this.hideSider();
    this._ensureWelcome();
  },

  onRenameSession(e) {
    const id = e.currentTarget.dataset.id;
    const s = this.data.sessions.find(x => x.id === id);
    if (!s) return;
    wx.showModal({
      title: '重命名会话',
      editable: true,
      placeholderText: '输入新名称',
      content: s.title,
      success: (r) => {
        if (r.confirm) {
          s.title = (r.content || '').trim() || s.title;
          s.updatedAt = Date.now();
          this._saveSessions(this.data.sessions.slice());
        }
      }
    })
  },

  onDeleteSession(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除会话',
      content: '确定删除该会话及其消息？不可恢复。',
      success: (r) => {
        if (!r.confirm) return;
        let sessions = this.data.sessions.slice();
        const idx = sessions.findIndex(x => x.id === id);
        if (idx >= 0) sessions.splice(idx, 1);
        let active = this.data.activeSessionId;
        if (active === id) {
          if (sessions.length === 0) {
            const newId = this._createInitialSession(sessions);
            sessions = wx.getStorageSync('wm_kg_sessions');
            active = newId;
          } else {
            active = sessions[0].id;
          }
        }
        const cur = sessions.find(x => x.id === active);
        this._saveSessions(sessions, active, cur?.messages?.map(m => this._withParsed(m)) || []);
      }
    })
  },

  _createInitialSession(existing) {
    const sessions = existing ? existing.slice() : [];
    const id = Date.now().toString(36);
    const welcome = {
      id: Date.now(),
      role: 'ai',
      text: '您好，我是基于吴门医派知识的AI助手，请问有什么可以帮您？',
      time: this._time()
    };
    sessions.unshift({
      id,
      title: '新的会话',
      updatedAt: Date.now(),
      messages: [welcome]
    });
    wx.setStorageSync('wm_kg_sessions', sessions);
    return id;
  },

  _saveSessions(sessions, activeId, messagesMirror) {
    wx.setStorageSync('wm_kg_sessions', sessions);
    if (activeId) {
      this.setData({
        sessions,
        activeSessionId: activeId,
        messages: messagesMirror ?? (sessions.find(s => s.id === activeId)?.messages || [])
      });
    } else {
      this.setData({
        sessions
      });
    }
  },

  /* ========== 输入与发送（保留，附带解析） ========== */
  onInput(e) {
    const v = e.detail.value;
    const sending = this.data.status !== 'idle';
    this.setData({
      inputValue: v,
      canSend: !!v.trim() && !sending
    })
  },
  onConfirm() {
    this._send(this.data.inputValue)
  },
  onSendTap() {
    this._send(this.data.inputValue)
  },

  _send(text) {
    if (this.data.status !== 'idle') return;
    const msg = (text || '').trim();
    if (!msg) return;
    const userMsg = {
      id: Date.now(),
      role: 'user',
      text: msg,
      time: this._time()
    };

    const sessions = this.data.sessions.slice();
    const s = sessions.find(x => x.id === this.data.activeSessionId);
    if (!s) return;
    s.messages.push(userMsg);
    s.updatedAt = Date.now();
    this._saveSessions(sessions);
    this.setData({
      messages: s.messages,
      inputValue: '',
      canSend: false,
      status: 'thinking',
      scrollToId: `msg-${userMsg.id}`
    }, () => this._callChatAPI(s.messages))
  },

  _callChatAPI(history) {
    const payload = {
      messages: history.slice(-12).map(m => ({
        role: m.role === 'ai' ? 'assistant' : m.role,
        content: m.text
      }))
    };
    const aiId = Date.now() + 1;
    const aiMsg = {
      id: aiId,
      role: 'ai',
      text: '',
      display: '',
      time: this._time(),
      streaming: true
    };

    const sessions = this.data.sessions.slice();
    const s = sessions.find(x => x.id === this.data.activeSessionId);
    if (!s) return;
    s.messages.push(aiMsg);
    s.updatedAt = Date.now();
    this._saveSessions(sessions);
    this.setData({
      messages: s.messages,
      status: 'answering',
      scrollToId: `msg-${aiId}`
    });

    // 这里仍是占位：你之后对接真实流式接口即可
    wx.request({
      url: 'https://your-api/chat-stream',
      method: 'POST',
      data: payload,
      timeout: 30000,
      success: (res) => {
        const chunks = res.data?.chunks;
        const final = res.data?.answer;
        if (Array.isArray(chunks) && chunks.length) {
          this._appendChunks(aiId, chunks, true)
        } else if (typeof final === 'string') {
          this._fakeStream(aiId, final)
        } else {
          this._finish(aiId, '（暂无回答）')
        }
      },
      fail: () => {
        this._finish(aiId, '抱歉，服务暂时不可用，请稍后重试。')
      }
    })
  },

  _appendChunks(aiId, chunks, persistOnEnd = true) {
    let i = 0;
    const tick = () => {
      if (i >= chunks.length) {
        this._finalizeStreaming(aiId, persistOnEnd);
        return
      }
      const part = String(chunks[i++] || '');
      this._append(aiId, part);
      this.setData({
        scrollToId: `msg-${aiId}`
      });
      setTimeout(tick, 30);
    };
    tick();
  },
  _fakeStream(aiId, full) {
    const pieces = full.split(/(\s+|，|。|；|！|？)/).filter(Boolean);
    this._appendChunks(aiId, pieces, true)
  },

  _append(aiId, piece) {
    const sessions = this.data.sessions.slice();
    const s = sessions.find(x => x.id === this.data.activeSessionId);
    if (!s) return;
    const idx = s.messages.findIndex(m => m.id === aiId);
    if (idx < 0) return;
    const old = s.messages[idx];
    const nextText = (old.text || '') + piece;
    const updated = {
      ...old,
      text: nextText,
      display: nextText,
      streaming: true
    };
    s.messages[idx] = this._withParsed(updated);
    this._saveSessions(sessions);
  },

  _finalizeStreaming(aiId) {
    const sessions = this.data.sessions.slice();
    const s = sessions.find(x => x.id === this.data.activeSessionId);
    if (!s) return;
    const idx = s.messages.findIndex(m => m.id === aiId);
    if (idx >= 0) {
      const done = {
        ...s.messages[idx],
        streaming: false,
        time: this._time()
      };
      s.messages[idx] = this._withParsed(done);
    }
    this._saveSessions(sessions);
    this.setData({
      status: 'idle',
      canSend: true,
      scrollToId: `msg-${aiId}`
    })
  },

  _finish(aiId, text) {
    const sessions = this.data.sessions.slice();
    const s = sessions.find(x => x.id === this.data.activeSessionId);
    if (!s) return;
    const idx = s.messages.findIndex(m => m.id === aiId);
    if (idx >= 0) {
      const done = {
        ...s.messages[idx],
        streaming: false,
        text,
        display: text,
        time: this._time()
      };
      s.messages[idx] = this._withParsed(done);
    }
    this._saveSessions(sessions);
    this.setData({
      status: 'idle',
      canSend: true,
      scrollToId: `msg-${aiId}`
    })
  },

  /* 其它保留 */
  noop() {},
  _time() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  },
});