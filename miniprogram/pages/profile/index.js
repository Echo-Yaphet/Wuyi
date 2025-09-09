// pages/profile/index.js
const app = getApp();

// 小工具：统一拿 API 基址（你可在 app.globalData 里配置 apiBase）
function getApiBase() {
  return (app && app.globalData && app.globalData.apiBase) || 'http://localhost:8080';
}

// 统一请求封装（自动带上 token）
function apiRequest({ url, method = 'GET', data = {}, header = {} }) {
  const token = wx.getStorageSync('token') || '';
  const base = getApiBase();
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${base}${url}`,
      method,
      data,
      header: {
        'content-type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...header,
      },
      success: (res) => {
        // 后端 Result<T> 统一包装：{ code, msg, data }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const body = res.data || {};
          // 兼容直接返回对象 或 Result 包装
          if (typeof body === 'object' && body !== null && ('data' in body || 'code' in body)) {
            if (body.code === 0 || body.code === 200 || body.code === undefined) {
              resolve(body.data !== undefined ? body.data : body);
            } else {
              reject(new Error(body.msg || '接口返回错误'));
            }
          } else {
            resolve(body);
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      },
      fail: (err) => reject(err),
    });
  });
}

// 登录：wx.login -> /wx/login，拿 token
async function ensureLogin() {
  let token = wx.getStorageSync('token');
  if (token) return token;

  const codeRes = await new Promise((resolve, reject) => {
    wx.login({
      success: resolve,
      fail: reject,
    });
  });
  const code = codeRes.code;
  if (!code) throw new Error('wx.login 失败');

  // 后端 WxLoginController：@RequestMapping("/wx") + @PostMapping("/login")
  const data = await apiRequest({
    url: '/wx/login',
    method: 'POST',
    data: { code },
  });

  // 兼容：data 可能是 { token: '...' } 或直接是字符串 token
  token = (data && (data.token || data.access_token || data.jwt)) || (typeof data === 'string' ? data : '');
  if (!token) throw new Error('登录未返回 token');

  wx.setStorageSync('token', token);
  return token;
}

// 将后端用户对象映射到页面 profile 字段
function mapUserToProfile(u = {}) {
  // 后端 User/WxUser 常见字段：nickname/nickName、userPic/avatarUrl
  const name = u.nickname || u.nickName || u.username || u.name || '未登录';
  const avatar = u.userPic || u.avatarUrl || u.avatar || '/assets/avatar/default.png';
  // 你页面绑定了 title/org，这里做容错（后端可能无这两个字段）
  const title = u.title || u.headline || '';
  const org = u.org || u.organization || u.company || '';
  return { name, avatar, title, org };
}

Page({
  data: {
    // 供 WXML 使用
    profile: {
      avatar: '/assets/avatar/default.png',
      name: '未登录',
      title: '',
      org: '',
    },
    // 你页面里若有统计类展示，可在此扩展（兼容即可，不改布局）
    stats: {
      historyCount: 0,
      notesCount: 0,
      readMinutes: 0,
    },
    loading: false,
  },

  onShow() {
    this._init();
  },

  async _init() {
    try {
      this.setData({ loading: true });
      await ensureLogin();
      await this._loadProfile();    // 拉用户资料
      // 如需统计类信息，可在此追加：await this._loadStats();
    } catch (e) {
      console.warn('profile init error:', e);
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
      wx.stopPullDownRefresh();
    }
  },

  async _loadProfile() {
    // 后端 UserController：@RequestMapping("/user") + @GetMapping("/userInfo")
    const user = await apiRequest({ url: '/user/userInfo' });
    const profile = mapUserToProfile(user || {});
    this.setData({ profile });
  },

  // 如果你的“我的”页有统计展示，可按你后端实际接口启用（示例）
  async _loadStats() {
    // 假设有 /user/stats（若无就删掉这个函数的调用）
    try {
      const s = await apiRequest({ url: '/user/stats' });
      this.setData({
        stats: {
          historyCount: Number(s.historyCount || s.history || 0),
          notesCount: Number(s.notesCount || s.notes || 0),
          readMinutes: Number(s.readMinutes || s.read_time || 0),
        }
      });
    } catch (e) {
      // 没有该接口就忽略
      console.debug('stats not available:', e.message);
    }
  },

  onPullDownRefresh() {
    this._init();
  },

  // ====== 你原有的事件：不改布局，只补健壮性 ======
  goEdit() {
    wx.navigateTo({ url: '/pages/profileEdit/index' });
  },

  gohistory() {
    wx.navigateTo({ url: '/pages/history/index' });
  }
});