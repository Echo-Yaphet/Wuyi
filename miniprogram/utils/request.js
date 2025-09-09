// 简单请求封装：自动拼接 BASE_URL、统一成功/失败处理
const app = getApp ? getApp() : null
const BASE_URL = (app && app.globalData && app.globalData.BASE_URL) || 'https://your-api-host' // TODO: 配成真实域名

export function request({ url, method = 'GET', data = {}, header = {} } = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}${url}`,
      method,
      data,
      header: {
        'Content-Type': 'application/json',
        ...header
      },
      success(res) {
        const ok = res.statusCode >= 200 && res.statusCode < 300
        if (!ok) {
          reject({ message: `HTTP ${res.statusCode}`, res })
          return
        }
        resolve(res.data)
      },
      fail(err) {
        reject(err)
      }
    })
  })
}