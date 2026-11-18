/**
 * 轻量代理服务 —— 代理豆瓣书籍搜索 API 和封面图片
 * 解决前端 CORS 和豆瓣图片防盗链问题
 */

import http from 'http'
import https from 'https'
import fs from 'fs'
import path from 'path'
import { URL, fileURLToPath } from 'url'

const PORT = 3001
const HOST = '0.0.0.0'

// 封面本地存储目录（项目根下 covers/）
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const COVERS_DIR = path.join(__dirname, 'covers')
fs.mkdirSync(COVERS_DIR, { recursive: true })

const EXT_BY_CONTENT_TYPE = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

function sendJson(res, code, data) {
  const body = JSON.stringify(data)
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

// 下载图片并保存到本地 covers/ 目录，返回本地访问路径
function saveCoverImage(imgUrl, res) {
  https.get(imgUrl, { headers: { 'Referer': 'https://book.douban.com/', 'User-Agent': 'Mozilla/5.0' } }, (upstream) => {
    if (upstream.statusCode !== 200) {
      sendJson(res, 502, { error: `图片获取失败: ${upstream.statusCode}` })
      return
    }
    const contentType = (upstream.headers['content-type'] || 'image/jpeg').split(';')[0].trim()
    const ext = EXT_BY_CONTENT_TYPE[contentType] || '.jpg'
    const fileName = `cover_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`
    const filePath = path.join(COVERS_DIR, fileName)
    const ws = fs.createWriteStream(filePath)
    upstream.pipe(ws)
    ws.on('finish', () => sendJson(res, 200, { path: `/covers/${fileName}` }))
    ws.on('error', () => {
      try { fs.unlinkSync(filePath) } catch {}
      sendJson(res, 500, { error: '封面保存失败' })
    })
  }).on('error', () => {
    sendJson(res, 502, { error: '图片下载失败' })
  })
}

function handleCoverSave(imgUrl, res) {
  if (!imgUrl || !/^https?:\/\//.test(imgUrl)) {
    sendJson(res, 400, { error: '无效的图片 URL' })
    return
  }
  saveCoverImage(imgUrl, res)
}

// 提供 covers/ 目录下的本地封面文件
function serveLocalCover(fileName, res) {
  // 只允许安全文件名，防止路径穿越
  if (!/^[a-zA-Z0-9._-]+$/.test(fileName)) {
    sendJson(res, 400, { error: '无效的文件名' })
    return
  }
  const filePath = path.join(COVERS_DIR, fileName)
  if (!path.resolve(filePath).startsWith(path.resolve(COVERS_DIR)) ||
      !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendJson(res, 404, { error: 'Not Found' })
    return
  }
  const type = MIME_BY_EXT[path.extname(fileName).toLowerCase()] || 'application/octet-stream'
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Access-Control-Allow-Origin': '*',
  })
  fs.createReadStream(filePath).pipe(res)
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
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

  if (parsed.pathname === '/cover-save') {
    if (req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        let imgUrl = ''
        try { imgUrl = JSON.parse(body).url || '' } catch {}
        handleCoverSave(imgUrl, res)
      })
    } else {
      handleCoverSave(parsed.searchParams.get('url'), res)
    }
    return
  }

  if (parsed.pathname.startsWith('/covers/')) {
    serveLocalCover(parsed.pathname.slice('/covers/'.length), res)
    return
  }

  sendJson(res, 404, { error: 'Not Found' })
})

server.listen(PORT, HOST, () => {
  console.log(`封面代理服务已启动: http://${HOST}:${PORT}`)
})
