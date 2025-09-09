// profileEdit/index.js

Page({
  data: {
    form: {
      avatarUrl: '',
      name: '',
      phone: '',
      email: '',
      bio: ''
    },
  },

  onLoad() {
    this.fetchUser();
  },

  // === 获取用户资料 ===
  fetchUser() {
    wx.request({
      url: '/wx/userInfo',
      method: 'GET',
      success: (res) => {
        // 兼容后端常见返回 { code, data } 或直接对象
        const data = res.data?.data || res.data || {};
        const {
          avatarUrl = '',
            name = '',
            phone = '',
            email = '',
            bio = ''
        } = data;

        this.setData({
          form: {
            avatarUrl,
            name,
            phone,
            email,
            bio
          }
        });
      },
      fail: () => {
        wx.showToast({
          title: '获取资料失败',
          icon: 'none'
        });
      }
    });
  },

  // === 输入联动（保持你原本的 data-field 方案） ===
  onInput(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    if (!field) return;
    
    const form = {
      ...this.data.form,
      [field]: value
    };
    this.setData({
      form
    });
  },

  // === 选择头像（保留你原事件名；是否立即上传看你后台是否给了上传接口） ===
  chooseAvatar() {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      success: (res) => {
        const filePath = res.tempFilePaths[0];
        // 如果后端有上传接口，可在这里 wx.uploadFile 后把返回的 url 写到 avatarUrl
        // 这里先把临时路径放入，保证预览正常
        this.setData({
          'form.avatarUrl': filePath
        });
      }
    });
  },

  // === 保存 ===
  save() {
    const payload = {
      ...this.data.form
    };

    wx.request({
      url: '/wx/updateUserInfo',
      method: 'POST',
      data: payload,
      success: (res) => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        const code = res.data?.code;
        if (ok && (code === undefined || code === 0)) {
          wx.showToast({
            title: '保存成功',
            icon: 'success'
          });
          // 视情况返回上一页，或刷新
          setTimeout(() => wx.navigateBack({
            delta: 1
          }), 600);
        } else {
          const msg = res.data?.message || res.data?.msg || '保存失败';
          wx.showToast({
            title: msg,
            icon: 'none'
          });
        }
      },
      fail: () => {
        wx.showToast({
          title: '网络异常，稍后再试',
          icon: 'none'
        });
      }
    });
  }
});