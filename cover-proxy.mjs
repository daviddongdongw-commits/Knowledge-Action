/**
 * 轻量代理服务 —— 代理豆瓣书籍搜索 API 和封面图片
 * 解决前端 CORS 和豆瓣图片防盗链问题
 */

import http from 'http'
import https from 'https'
import { URL } from 'url'

const PORT = 3001
const HOST = '0.0.0.0'

function sendJson(res, code, data) {
  const body = JSON.stringify(data)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  })
  res.end(body)
}

function proxyImage(url, res) {
  https.get(url, { headers: { 'Referer': 'https://book.douban.com/', 'User-Agent': 'Mozilla/5.0' } }, (upstream) => {
    if (upstream.statusCode !== 200) {
      sendJson(res, 502, { error: `图片获取失败: ${upstream.statusCode}` })
      return
    }
    const contentType = upstream.headers['content-type'] || 'image/jpeg'
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    })
    upstream.pipe(res)
  }).on('error', () => {
    sendJson(res, 502, { error: '图片代理失败' })
  })
}

function proxyDoubanSearch(keyword, res) {
  const apiUrl = `https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(keyword)}`
  https.get(apiUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (upstream) => {
    let data = ''
    upstream.on('data', (chunk) => { data += chunk })
    upstream.on('end', () => {
      try {
        const items = JSON.parse(data)
        // 转换为统一格式，把封面 URL 替换为本地代理 URL
        const results = items
          .filter(item => item.type === 'b' && item.pic)
          .map(item => {
            // 把豆瓣小图 URL 升级为大图
            const largePic = item.pic.replace('/view/subject/s/', '/view/subject/l/')
            // 返回原始豆瓣大图 URL，前端通过 /cover-img 代理获取
            const proxiedPic = `/cover-img?url=${encodeURIComponent(largePic)}`
            return {
              title: item.title,
              author: item.author_name || '',
              coverUrl: proxiedPic,
              year: item.year || '',
              doubanId: item.id,
            }
          })
        sendJson(res, 200, { results })
      } catch (e) {
        sendJson(res, 500, { error: '解析豆瓣数据失败' })
      }
    })
  }).on('error', () => {
    sendJson(res, 502, { error: '豆瓣搜索请求失败' })
  })
}

const server = http.createServer((req, res) => {
  const parsed = new URL(req.url, `http://${HOST}:${PORT}`)

  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    })
    res.end()
    return
  }

  if (parsed.pathname === '/cover-search') {
    const keyword = parsed.searchParams.get('q')
    if (!keyword) {
      sendJson(res, 400, { error: '缺少参数 q' })
      return
    }
    proxyDoubanSearch(keyword, res)
    return
  }

  if (parsed.pathname === '/cover-img') {
    const imgUrl = parsed.searchParams.get('url')
    if (!imgUrl || !imgUrl.startsWith('https://')) {
      sendJson(res, 400, { error: '无效的图片 URL' })
      return
    }
    proxyImage(imgUrl, res)
    return
  }

  sendJson(res, 404, { error: 'Not Found' })
})

server.listen(PORT, HOST, () => {
  console.log(`封面代理服务已启动: http://${HOST}:${PORT}`)
})
