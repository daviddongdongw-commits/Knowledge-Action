/**
 * Vercel Serverless：封面转存
 * POST /api/cover-save  body: { url: 图片URL }
 *
 * Vercel 文件系统只读，无法落盘。线上环境返回一个可长期使用的
 * /cover-img?url=... 代理路径（带浏览器缓存），由前端直接采用。
 */

const EXT_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
}

function respond(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...EXT_HEADERS })
  res.end(JSON.stringify(data))
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, EXT_HEADERS)
    res.end()
    return
  }

  let imgUrl = ''
  if (req.method === 'POST') {
    try {
      imgUrl = JSON.parse(req.body || '{}').url || ''
    } catch {}
  } else {
    imgUrl = req.query.url || ''
  }

  if (!imgUrl || !/^https?:\/\//.test(imgUrl)) {
    respond(res, 400, { error: '无效的图片 URL' })
    return
  }

  // 线上无本地存储：返回代理路径，前端将其作为封面 URL 保存
  respond(res, 200, { path: `/cover-img?url=${encodeURIComponent(imgUrl)}`, mode: 'proxy' })
}
