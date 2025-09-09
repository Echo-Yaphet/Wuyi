// pages/books/index.js
const API_BASE = 'https://api.example.com'; // TODO: 换成真实后端域名

Page({
  data: {
    // ====== 的原数据（保留，可按需精简） ======
    dynastyList: ["全部","先秦","汉代","唐代","宋代","金元","明代","清代"],
    typeList: ["全部","经典著作","温病学说","伤寒论著","医案医话","本草典籍"],

    selectedDynasty: '全部',
    selectedType: '全部',
    searchKeyword: '',

    // 展示用：保持原来的字段名与 WXML 绑定一致（filteredBooks）
    filteredBooks: [],

    // ====== 新增：分页 & 加载态 ======
    pageNum: 1,
    pageSize: 12,
    hasMore: true,
    loading: false,
  },

  onLoad() {
    this.resetAndFetch(); // 首次加载
  },

  // ====== 交互（不改的 UI）======
  onSearchInput(e) {
    this.setData({ searchKeyword: e.detail.value || '' });
  },
  onSearchConfirm() {
    this.resetAndFetch();
  },

  selectDynasty(e) {
    const v = e.currentTarget.dataset.value;
    if (v === this.data.selectedDynasty) return;
    this.setData({ selectedDynasty: v }, this.resetAndFetch);
  },
  selectType(e) {
    const v = e.currentTarget.dataset.value;
    if (v === this.data.selectedType) return;
    this.setData({ selectedType: v }, this.resetAndFetch);
  },

  // 卡片点击跳转
  openBook(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/bookRead/index?id=${id}` });
  },

  // 下拉刷新（如页面有启用）
  onPullDownRefresh() {
    this.resetAndFetch(() => wx.stopPullDownRefresh());
  },

  // 触底加载更多（如页面有启用）
  onReachBottom() {
    if (!this.data.hasMore || this.data.loading) return;
    this.fetchBooks();
  },

  // ====== 新增：统一重置再拉取 ======
  resetAndFetch(cb) {
    this.setData(
      { pageNum: 1, hasMore: true, filteredBooks: [] },
      () => this.fetchBooks(cb)
    );
  },

  // ====== 核心：对接后端分页接口 /wx/books ======
  fetchBooks(cb) {
    if (this.data.loading || !this.data.hasMore) {
      cb && cb();
      return;
    }
    this.setData({ loading: true });

    const { pageNum, pageSize, searchKeyword, selectedDynasty, selectedType } = this.data;

    const params = {
      pageNum,
      pageSize
    };
    if (searchKeyword && searchKeyword.trim()) params.keyword = searchKeyword.trim();
    if (selectedDynasty && selectedDynasty !== '全部') params.dynasty = selectedDynasty;
    if (selectedType && selectedType !== '全部') params.category = selectedType;

    wx.request({
      url: `${API_BASE}/wx/books`,
      method: 'GET',
      data: params,
      timeout: 15000,
      success: (res) => {
        // 约定：Result<T> 格式 { code:0, msg:'OK', data: { total, rows: [...] } }
        const ok = res.statusCode === 200 && res.data && (res.data.code === 0 || res.data.success === true);
        if (!ok) {
          wx.showToast({ title: res.data?.msg || '加载失败', icon: 'none' });
          return;
        }

        // PageBean
        const pageBean = res.data.data || {};
        const rows = Array.isArray(pageBean.rows) ? pageBean.rows : [];
        const mapped = rows.map(this.mapServerBookToCard);

        const merged = this.data.pageNum === 1
          ? mapped
          : this.data.filteredBooks.concat(mapped);

        // 是否还有更多
        const total = Number(pageBean.total || 0);
        const hasMore = merged.length < total;

        this.setData({
          filteredBooks: merged,
          hasMore,
          pageNum: hasMore ? (this.data.pageNum + 1) : this.data.pageNum
        });
      },
      fail: () => {
        wx.showToast({ title: '网络错误', icon: 'none' });
      },
      complete: () => {
        this.setData({ loading: false });
        cb && cb();
      }
    });
  },

  // ====== 映射：后端字段 → 页面使用的字段 ======
  mapServerBookToCard(item) {
    // 后端 Book/BookVO 字段：id, bookName, author, dynasty, category, coverUrl, publishYear
    return {
      id: item.id,
      title: item.bookName || item.title || '',
      author: item.author || '',
      dynasty: item.dynasty || '',
      year: item.publishYear || '',
      img: item.coverUrl || '',   // 的 WXML 用的是 item.img
      category: item.category || ''
    };
  }
});