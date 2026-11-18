/**
 * 知行 · 存储层
 * 基于 localStorage 的本地数据持久化
 */

const STORAGE_PREFIX = 'zhixing_'

// 存档展示模式下锁定写入，避免访客改动存档数据
let locked = false

const Storage = {
  // 通用读取
  get(key, defaultValue = []) {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + key)
      return raw ? JSON.parse(raw) : defaultValue
    } catch (e) {
      console.error('Storage.get error:', key, e)
      return defaultValue
    }
  },

  // 通用写入
  set(key, value) {
    if (locked) return false
    try {
      localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value))
      return true
    } catch (e) {
      console.error('Storage.set error:', key, e)
      return false
    }
  },

  // 存档模式：锁定 / 解锁写入
  lock() {
    locked = true
  },

  unlock() {
    locked = false
  },

  isLocked() {
    return locked
  },

  // 删除单条
  remove(key) {
    localStorage.removeItem(STORAGE_PREFIX + key)
  },

  // 清空全部
  clearAll() {
    Object.keys(localStorage)
      .filter(k => k.startsWith(STORAGE_PREFIX))
      .forEach(k => localStorage.removeItem(k))
  }
}

// 生成唯一 ID
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

// 格式化日期
function formatDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const diff = now - d
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前'
  if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前'
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

// 导出
export { Storage, genId, formatDate }
