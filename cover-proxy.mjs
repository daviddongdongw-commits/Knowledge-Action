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

// 存档文件（发布到 GitHub 展示时读取 data/archive.json）
const DATA_DIR = path.join(__dirname, 'data')
const ARCHIVE_PATH = path.join(DATA_DIR, 'archive.json')
const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024

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

// 把书名清洗成可以安全使用的文件名
const MAX_NAME_LENGTH = 60
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

function sanitizeCoverName(title) {
  let name = String(title || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|%]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .slice(0, MAX_NAME_LENGTH)
    .trim()
  if (!name || WINDOWS_RESERVED.test(name)) name = 'cover'
  return name
}

// 查找某个书名对应的已有封面文件（任意支持的扩展名）
function findExistingCover(baseName) {
  for (const ext of Object.keys(MIME_BY_EXT)) {
    const name = `${baseName}${ext}`
    if (fs.existsSync(path.join(COVERS_DIR, name))) return name
  }
  return null
}

// 校验文件名是否可用于 covers/ 目录（允许中文，禁止路径分隔与控制字符）
function isSafeCoverName(fileName) {
  if (typeof fileName !== 'string' || !fileName) return false
  if (fileName.includes('/') || fileName.includes('\\')) return false
  if (fileName.includes('..')) return false
  if (/[\u0000-\u001f\u007f]/.test(fileName)) return false
  return true
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
// 优先使用书名作为文件名，本地已有同名封面时直接复用，不重复下载
function saveCoverImage(imgUrl, title, res) {
  const baseName = sanitizeCoverName(title)

  const existing = findExistingCover(baseName)
  if (existing) {
    sendJson(res, 200, { path: `/covers/${encodeURIComponent(existing)}`, reused: true })
    return
  }

  const tmpName = `.tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const tmpPath = path.join(COVERS_DIR, tmpName)

  https.get(imgUrl, { headers: { 'Referer': 'https://book.douban.com/', 'User-Agent': 'Mozilla/5.0' } }, (upstream) => {
    if (upstream.statusCode !== 200) {
      sendJson(res, 502, { error: `图片获取失败: ${upstream.statusCode}` })
      return
    }
    const contentType = (upstream.headers['content-type'] || 'image/jpeg').split(';')[0].trim()
    const ext = EXT_BY_CONTENT_TYPE[contentType] || '.jpg'
    const fileName = `${baseName}${ext}`
    const filePath = path.join(COVERS_DIR, fileName)
    const ws = fs.createWriteStream(tmpPath)
    upstream.pipe(ws)
    ws.on('finish', () => {
      try {
        fs.renameSync(tmpPath, filePath)
        sendJson(res, 200, { path: `/covers/${encodeURIComponent(fileName)}` })
      } catch (e) {
        try { fs.unlinkSync(tmpPath) } catch {}
        sendJson(res, 500, { error: '封面保存失败' })
      }
    })
    ws.on('error', () => {
      try { fs.unlinkSync(tmpPath) } catch {}
      sendJson(res, 500, { error: '封面保存失败' })
    })
  }).on('error', () => {
    sendJson(res, 502, { error: '图片下载失败' })
  })
}

function handleCoverSave(imgUrl, title, res) {
  if (!imgUrl || !/^https?:\/\//.test(imgUrl)) {
    sendJson(res, 400, { error: '无效的图片 URL' })
    return
  }
  saveCoverImage(imgUrl, title, res)
}

// 把已保存的随机名封面改成书名，便于日后查找
function renameCover(fromName, newTitle, res) {
  if (!isSafeCoverName(fromName)) {
    sendJson(res, 400, { error: '无效的原文件名' })
    return
  }
  const baseName = sanitizeCoverName(newTitle)
  const ext = path.extname(fromName).toLowerCase()
  const targetName = `${baseName}${MIME_BY_EXT[ext] ? ext : '.jpg'}`

  if (fromName === targetName) {
    sendJson(res, 200, { path: `/covers/${encodeURIComponent(targetName)}` })
    return
  }

  const fromPath = path.join(COVERS_DIR, fromName)
  const targetPath = path.join(COVERS_DIR, targetName)

  if (!fs.existsSync(fromPath)) {
    // 旧文件已不在，但目标文件存在时视为已迁移完成
    if (fs.existsSync(targetPath)) {
      sendJson(res, 200, { path: `/covers/${encodeURIComponent(targetName)}`, reused: true })
    } else {
      sendJson(res, 404, { error: '原封面文件不存在' })
    }
    return
  }

  try {
    if (fs.existsSync(targetPath)) {
      // 目标已存在（同名书共用封面），删除冗余的旧文件
      fs.unlinkSync(fromPath)
    } else {
      fs.renameSync(fromPath, targetPath)
    }
    sendJson(res, 200, { path: `/covers/${encodeURIComponent(targetName)}` })
  } catch (e) {
    sendJson(res, 500, { error: '封面重命名失败' })
  }
}

// 提供 covers/ 目录下的本地封面文件
function serveLocalCover(rawName, res) {
  let fileName = rawName
  try {
    fileName = decodeURIComponent(rawName)
  } catch (e) {
    sendJson(res, 400, { error: '无效的文件名' })
    return
  }
  if (!isSafeCoverName(fileName)) {
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

// 把前端导出的存档直接写入项目 data/archive.json（覆盖旧文件）
function saveArchive(body, res) {
  if (!body) {
    sendJson(res, 400, { error: '存档内容为空' })
    return
  }
  if (Buffer.byteLength(body) > MAX_ARCHIVE_BYTES) {
    sendJson(res, 413, { error: '存档内容过大' })
    return
  }

  let payload
  try {
    payload = JSON.parse(body)
  } catch (e) {
    sendJson(res, 400, { error: '存档内容不是合法 JSON' })
    return
  }

  const data = payload && payload.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    sendJson(res, 400, { error: '存档内容缺少 data 字段' })
    return
  }
  for (const key of ['categories', 'books', 'notes', 'actions']) {
    if (data[key] !== undefined && !Array.isArray(data[key])) {
      sendJson(res, 400, { error: `存档字段 ${key} 必须是数组` })
      return
    }
  }

  const json = JSON.stringify(payload, null, 2)
  const tmpPath = path.join(DATA_DIR, `.archive.${Date.now()}.tmp`)
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(tmpPath, json, 'utf8')
    fs.renameSync(tmpPath, ARCHIVE_PATH)
  } catch (e) {
    try { fs.unlinkSync(tmpPath) } catch {}
    sendJson(res, 500, { error: '写入 data/archive.json 失败' })
    return
  }

  sendJson(res, 200, {
    ok: true,
    path: 'data/archive.json',
    bytes: Buffer.byteLength(json),
    exportedAt: payload.exportedAt || null,
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
        let title = ''
        try {
          const payload = JSON.parse(body)
          imgUrl = payload.url || ''
          title = payload.title || ''
        } catch {}
        handleCoverSave(imgUrl, title, res)
      })
    } else {
      handleCoverSave(parsed.searchParams.get('url'), parsed.searchParams.get('title') || '', res)
    }
    return
  }

  if (parsed.pathname === '/cover-rename') {
    if (req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        let from = ''
        let title = ''
        try {
          const payload = JSON.parse(body)
          from = payload.from || ''
          title = payload.title || ''
        } catch {}
        renameCover(from, title, res)
      })
    } else {
      renameCover(parsed.searchParams.get('from'), parsed.searchParams.get('title') || '', res)
    }
    return
  }

  if (parsed.pathname === '/archive-save') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: '请使用 POST' })
      return
    }
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (Buffer.byteLength(body) > MAX_ARCHIVE_BYTES) {
        sendJson(res, 413, { error: '存档内容过大' })
        req.destroy()
      }
    })
    req.on('end', () => saveArchive(body, res))
    return
  }

  if (parsed.pathname.startsWith('/covers/')) {
    serveLocalCover(parsed.pathname.slice('/covers/'.length), res)
    return
  }

  sendJson(res, 404, { error: 'Not Found' })
})

let listenRetry = 0
const MAX_LISTEN_RETRY = 10

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && listenRetry < MAX_LISTEN_RETRY) {
    listenRetry += 1
    console.log(`端口 ${PORT} 被占用，${listenRetry} 秒后重试（第 ${listenRetry} 次）...`)
    setTimeout(() => server.listen(PORT, HOST), 1000)
    return
  }
  console.error('封面代理启动失败:', err.message)
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  console.log(`封面代理服务已启动: http://${HOST}:${PORT}`)
})
