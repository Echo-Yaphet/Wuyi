Page({
  data: {
    historyList: []
  },

  onLoad() {
    this.getHistory();
  },

  // 模拟接口获取数据
  getHistory() {
    // TODO: 替换为 wx.request 调用真实接口
    const mockData = [
      { id: 1, title: "黄帝内经", readTime: "2025-08-28 14:32" },
      { id: 2, title: "伤寒论", readTime: "2025-08-29 19:45" },
      { id: 3, title: "本草纲目", readTime: "2025-08-30 09:10" }
    ];
    wx.request({
      url: "https://的接口地址/api/history",
      method: "GET",
      success: (res) => {
        this.setData({
          historyList: res.data
        });
      }
    });
    this.setData({
      historyList: mockData
    });
  },

  // 点击跳转古籍阅读页面
  goToBook(e) {
    const bookId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/bookRead/index?id=${bookId}`
    });
  }
});