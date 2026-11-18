/**
 * 知行 · 一键启动
 * 同时启动封面代理服务（3001）和前端开发服务器（3000）
 * 关闭窗口或按 Ctrl+C 时一并退出
 */

import { spawn } from 'child_process'
import net from 'net'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROXY_PORT = 3001
const APP_PORT = 3000

const children = []
let shuttingDown = false

function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (!child.killed) {
      try { child.kill() } catch {}
    }
  }
  setTimeout(() => process.exit(code), 300)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
process.on('exit', () => shutdown(0))

function waitForPort(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve) => {
    const attempt = () => {
      const socket = net.connect({ port, host: '127.0.0.1' })
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() > deadline) resolve(false)
        else setTimeout(attempt, 300)
      })
    }
    attempt()
  })
}

async function main() {
  console.log('正在启动封面代理服务...')
  const proxy = spawn(process.execPath, [path.join(__dirname, 'cover-proxy.mjs')], {
    cwd: __dirname,
    stdio: 'inherit',
  })
  children.push(proxy)

  proxy.on('exit', (code) => {
    if (!shuttingDown) {
      console.log(`\n[警告] 封面代理已退出（代码 ${code}），封面搜索将不可用`)
    }
  })

  const proxyReady = await waitForPort(PROXY_PORT)
  if (proxyReady) {
    console.log(`封面代理已就绪（端口 ${PROXY_PORT}）\n`)
  } else {
    console.log('[警告] 封面代理未能就绪，书籍封面搜索将不可用\n')
  }

  console.log('正在启动主程序，浏览器会自动打开...\n')
  const vite = spawn(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['vite', '--host', '0.0.0.0', '--port', String(APP_PORT), '--open'],
    { cwd: __dirname, stdio: 'inherit', shell: process.platform === 'win32' }
  )
  children.push(vite)

  vite.on('exit', (code) => {
    console.log('\n主程序已停止，正在关闭...')
    shutdown(code || 0)
  })
}

main()
