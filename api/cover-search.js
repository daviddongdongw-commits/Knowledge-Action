/**
 * Vercel Serverless：豆瓣书籍搜索代理
 * GET /api/cover-search?q=关键词
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

  const keyword = req.query.q
  if (!keyword) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', ...EXT_HEADERS })
    res.end(JSON.stringify({ error: '缺少参数 q' }))
    return
  }

  const apiUrl = `https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(keyword)}`
  try {
    const upstream = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    })
    if (!upstream.ok) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', ...EXT_HEADERS })
      res.end(JSON.stringify({ error: `豆瓣搜索失败: ${upstream.status}` }))
      return
    }
    const items = await upstream.json()
    const results = items
      .filter(item => item.type === 'b' && item.pic)
      .map(item => {
        const largePic = item.pic.replace('/view/subject/s/', '/view/subject/l/')
        const proxiedPic = `/cover-img?url=${encodeURIComponent(largePic)}`
        return {
          title: item.title,
          author: item.author_name || '',
          coverUrl: proxiedPic,
          year: item.year || '',
          doubanId: item.id,
        }
      })
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...EXT_HEADERS })
    res.end(JSON.stringify({ results }))
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', ...EXT_HEADERS })
    res.end(JSON.stringify({ error: '豆瓣搜索请求失败' }))
  }
}
