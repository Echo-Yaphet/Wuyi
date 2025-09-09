Page({
  goBooks() {
    wx.switchTab({   // tabBar 页面
      url: '/pages/books/index'
    })
  },
  goKnowledge() {
    wx.switchTab({   // tabBar 页面
      url: '/pages/knowledgeGraph/index'
    })
  },

// === 热门古籍（mock，可对接接口）===
loadHotBooks(){
  const demo = [
    {id: 101, name: '黄帝内经', author: '黄帝', cover: '/assets/covers/nei_jing.jpg'},
    {id: 102, name: '伤寒论', author: '张仲景', cover: '/assets/covers/shang_han_lun.jpg'},
    {id: 103, name: '本草纲目', author: '李时珍', cover: '/assets/covers/ben_cao.jpg'}
  ];
  this.setData({ hotBooks: demo });
},
goRead(e){
  const id = e.currentTarget.dataset.id;
  wx.navigateTo({ url: `/pages/bookRead/index?id=${id}` });
},
onShow(){
  // 首次进入或返回时刷新热门
  try{ this.loadHotBooks && this.loadHotBooks(); }catch(e){}
}

})