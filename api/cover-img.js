/**
 * Vercel Serverless：豆瓣封面图片代理（解决防盗链）
 * GET /api/cover-img?url=图片URL
 *
 * 注意：Vercel 文件系统只读，线上环境封面不落盘，每次实时代理拉取。
 * 浏览器端会对同一 URL 做缓存（Cache-Control 头）。
 */

const EXT_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, EXT_HEADERS)
    res.end()
    return
  }

  const imgUrl = req.query.url
  if (!imgUrl || !imgUrl.startsWith('https://')) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', ...EXT_HEADERS })
    res.end(JSON.stringify({ error: '无效的图片 URL' }))
    return
  }

  try {
    const upstream = await fetch(imgUrl, {
      headers: {
        'Referer': 'https://book.douban.com/',
        'User-Agent': 'Mozilla/5.0',
      },
    })
    if (!upstream.ok || !upstream.body) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', ...EXT_HEADERS })
      res.end(JSON.stringify({ error: `图片获取失败: ${upstream.status}` }))
      return
    }
    const contentType = upstream.headers.get('content-type') || 'image/jpeg'
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
      ...EXT_HEADERS,
    })
    // Node.js Web Stream -> Node Stream
    const { Readable } = await import('stream')
    Readable.fromWeb(upstream.body).pipe(res)
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', ...EXT_HEADERS })
    res.end(JSON.stringify({ error: '图片代理失败' }))
  }
}
