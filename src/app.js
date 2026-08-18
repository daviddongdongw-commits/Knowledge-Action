/**
 * 知行 · 应用主逻辑
 * 读书 -> 知识管理 -> 指导行动
 */

import { Storage, genId, formatDate } from './storage.js'

// ===== 封面代理服务 URL =====
// 优先尝试 3001 外网直连，失败后回退到 Vite proxy 相对路径
function getProxyBase() {
  const origin = window.location.origin
  return origin.replace('3000-', '3001-')
}
const PROXY_BASE_DIRECT = getProxyBase()
const PROXY_BASE_FALLBACK = '' // 相对路径，走 Vite proxy
let proxyBase = PROXY_BASE_DIRECT
let proxyChecked = false

// 启动时检测 3001 外网端口是否可用，不可用则切换到 Vite proxy
async function detectProxy() {
  try {
    const resp = await fetch(`${PROXY_BASE_DIRECT}/cover-search?q=test`, { method: 'GET', signal: AbortSignal.timeout(5000) })
    if (resp.ok) {
      proxyBase = PROXY_BASE_DIRECT
    } else {
      proxyBase = PROXY_BASE_FALLBACK
    }
  } catch {
    proxyBase = PROXY_BASE_FALLBACK
  }
  proxyChecked = true
}
detectProxy()

// ===== 数据模型 =====
// 书籍: { id, title, author, color, totalPages, currentPage, createdAt }
// 笔记: { id, bookId, type('quote'|'insight'|'summary'), content, page, createdAt }
// 行动: { id, title, description, source('manual'|'note'), noteId, bookId, priority('high'|'medium'|'low'), status('pending'|'doing'|'done'), createdAt, completedAt }

// 书籍封面颜色预设
const BOOK_COLORS = [
  '#4f46e5', '#3b82f6', '#10b981', '#f59e0b',
  '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4',
  '#84cc16', '#f97316', '#6366f1', '#14b8a6'
]

// 笔记类型配置
const NOTE_TYPES = {
  quote: { label: '摘录', class: 'type-quote' },
  insight: { label: '感悟', class: 'type-insight' },
  summary: { label: '总结', class: 'type-summary' }
}

// 行动优先级配置
const PRIORITY_CONFIG = {
  high: { label: '高', class: 'priority-high' },
  medium: { label: '中', class: 'priority-medium' },
  low: { label: '低', class: 'priority-low' }
}

// ===== 全局状态 =====
let currentView = 'books'
let editingBookId = null
let editingNoteId = null
let editingActionId = null
let dragData = null

// ===== DOM 辅助 =====
const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => document.querySelectorAll(sel)

// ===== 导航切换 =====
function switchView(viewName) {
  currentView = viewName
  $$('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === viewName)
  })
  $$('.view').forEach(view => {
    view.classList.toggle('active', view.id === `view-${viewName}`)
  })
  if (viewName === 'dashboard') renderDashboard()
}

// ===== Toast 提示 =====
function showToast(message, type = 'info') {
  const toast = document.createElement('div')
  toast.className = `toast ${type}`
  toast.textContent = message
  $('#toastContainer').appendChild(toast)
  setTimeout(() => {
    toast.style.opacity = '0'
    toast.style.transform = 'translateX(40px)'
    toast.style.transition = 'all 0.3s ease'
    setTimeout(() => toast.remove(), 300)
  }, 2500)
}

// ===== 模态框 =====
function openModal(title, bodyHTML) {
  $('#modalTitle').textContent = title
  $('#modalBody').innerHTML = bodyHTML
  $('#modalOverlay').classList.add('active')
}

function closeModal() {
  $('#modalOverlay').classList.remove('active')
  editingBookId = null
  editingNoteId = null
  editingActionId = null
}

// ===== 书籍管理 =====
function getBooks() {
  return Storage.get('books', [])
}

function saveBooks(books) {
  Storage.set('books', books)
}

function renderBooks() {
  const books = getBooks()
  const grid = $('#bookGrid')

  if (books.length === 0) {
    grid.innerHTML = `
      <div class="book-empty">
        <div class="book-empty-icon">📚</div>
        <p>书架还是空的，点击「添加书籍」开始阅读之旅吧</p>
      </div>
    `
    return
  }

  grid.innerHTML = books.map(book => {
    const progress = book.totalPages > 0
      ? Math.min(100, Math.round((book.currentPage / book.totalPages) * 100))
      : 0
    const coverStyle = book.coverUrl
      ? `background-image: url('${escapeHtml(book.coverUrl)}'); background-size: cover; background-position: center top;`
      : `background: ${book.color};`
    return `
      <div class="book-card${book.coverUrl ? ' book-card-has-cover' : ''}" data-book-id="${book.id}" style="${coverStyle}" data-fallback-color="${book.color}" data-fallback-char="${book.title.charAt(0) || '?'}">
        ${!book.coverUrl ? `<span class="book-cover-fallback-char">${book.title.charAt(0) || '?'}</span>` : ''}
        <div class="book-overlay">
          <div class="book-info">
            <div class="book-title" title="${escapeHtml(book.title)}">${escapeHtml(book.title)}</div>
            <div class="book-author">${escapeHtml(book.author || '未知作者')}</div>
            <div class="book-progress">
              <div class="book-progress-bar">
                <div class="book-progress-fill" style="width: ${progress}%"></div>
              </div>
              <span class="book-progress-text">${book.currentPage}/${book.totalPages || '?'}</span>
            </div>
          </div>
          <div class="book-actions">
            <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();window.app.editBook('${book.id}')">编辑</button>
            <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();window.app.addNoteForBook('${book.id}')">记笔记</button>
            <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();window.app.deleteBook('${book.id}')">删除</button>
          </div>
        </div>
      </div>
    `
  }).join('')

  // 点击书卡跳转到该书笔记
  $$('.book-card').forEach(card => {
    card.addEventListener('click', () => {
      const bookId = card.dataset.bookId
      $('#noteFilterBook').value = bookId
      switchView('notes')
      renderNotes()
    })
  })

  // 封面图片加载失败时回退到纯色+首字
  $$('.book-card-has-cover').forEach(card => {
    const bgImg = card.style.backgroundImage
    if (!bgImg || bgImg === 'none') return
    const url = bgImg.replace(/url\(['"]?|['"]?\)/g, '')
    if (!url) return
    const img = new Image()
    img.src = url
    img.onerror = () => {
      const color = card.dataset.fallbackColor || '#4f46e5'
      const char = card.dataset.fallbackChar || '?'
      card.classList.remove('book-card-has-cover')
      card.style.background = color
      card.style.backgroundImage = 'none'
      const overlay = card.querySelector('.book-overlay')
      if (overlay) {
        const fallback = document.createElement('span')
        fallback.className = 'book-cover-fallback-char'
        fallback.textContent = char
        card.insertBefore(fallback, overlay)
      }
    }
  })
}

function showBookForm(bookId = null) {
  editingBookId = bookId
  const book = bookId ? getBooks().find(b => b.id === bookId) : null
  const colorOptions = BOOK_COLORS.map(c =>
    `<div class="color-option ${(!book && c === BOOK_COLORS[0]) || (book && book.color === c) ? 'selected' : ''}" data-color="${c}" style="background: ${c}"></div>`
  ).join('')

  openModal(book ? '编辑书籍' : '添加书籍', `
    <form id="bookForm" onsubmit="return false">
      <div class="form-group">
        <label class="form-label">书名 <span class="required">*</span></label>
        <input type="text" class="form-input" id="bookTitle" value="${book ? escapeHtml(book.title) : ''}" placeholder="请输入书名" required>
      </div>
      <div class="form-group">
        <label class="form-label">作者</label>
        <input type="text" class="form-input" id="bookAuthor" value="${book ? escapeHtml(book.author || '') : ''}" placeholder="请输入作者">
      </div>
      <div class="form-group">
        <label class="form-label">封面图片</label>
        <div class="cover-input-row">
          <input type="text" class="form-input" id="bookCoverUrl" value="${book ? escapeHtml(book.coverUrl || '') : ''}" placeholder="粘贴封面图片 URL（可选）">
          <button class="btn btn-secondary" type="button" id="btnSearchCover">搜索封面</button>
        </div>
        <div class="cover-preview" id="coverPreview">${book && book.coverUrl ? `<img src="${escapeHtml(book.coverUrl)}" alt="封面预览" onerror="this.style.display='none'">` : ''}</div>
        <div class="form-hint">输入书名后点击「搜索封面」可自动获取，或直接粘贴图片 URL</div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">总页数</label>
          <input type="number" class="form-input" id="bookTotalPages" value="${book ? book.totalPages : ''}" placeholder="如 300" min="1">
        </div>
        <div class="form-group">
          <label class="form-label">当前页</label>
          <input type="number" class="form-input" id="bookCurrentPage" value="${book ? book.currentPage : 0}" placeholder="0" min="0">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">封面颜色（无封面时使用）</label>
        <div class="color-picker" id="colorPicker">${colorOptions}</div>
      </div>
      <div class="form-actions">
        <button class="btn btn-secondary" onclick="window.app.closeModal()">取消</button>
        <button class="btn btn-primary" onclick="window.app.saveBook()">保存</button>
      </div>
    </form>
  `)

  // 颜色选择
  $$('#colorPicker .color-option').forEach(opt => {
    opt.addEventListener('click', () => {
      $$('#colorPicker .color-option').forEach(o => o.classList.remove('selected'))
      opt.classList.add('selected')
    })
  })

  // 搜索封面
  $('#btnSearchCover').addEventListener('click', searchBookCover)
}

// 搜索书籍封面（通过本地代理使用豆瓣搜索 API）
async function searchBookCover() {
  const title = $('#bookTitle').value.trim()
  if (!title) {
    showToast('请先输入书名', 'error')
    return
  }

  const btn = $('#btnSearchCover')
  btn.textContent = '搜索中...'
  btn.disabled = true

  const query = encodeURIComponent(title)

  // 尝试请求，失败则切换到 fallback 重试
  let resp = null
  let lastError = null
  for (const base of [proxyBase, PROXY_BASE_FALLBACK]) {
    try {
      resp = await fetch(`${base}/cover-search?q=${query}`)
      if (resp.ok) {
        proxyBase = base // 成功了就锁定这个 base
        break
      }
    } catch (e) {
      lastError = e
    }
  }

  if (!resp || !resp.ok) {
    showToast('搜索失败，请手动粘贴图片 URL', 'error')
    btn.textContent = '搜索封面'
    btn.disabled = false
    return
  }

  try {
    const data = await resp.json()

    if (data.results && data.results.length > 0) {
      // 展示多个搜索结果供用户选择
      const resultsHTML = data.results.slice(0, 6).map((item, idx) => {
        const fullCoverUrl = `${proxyBase}${item.coverUrl}`
        return `
        <div class="cover-search-result" data-cover-url="${escapeHtml(fullCoverUrl)}" data-title="${escapeHtml(item.title)}" data-author="${escapeHtml(item.author)}" style="cursor: pointer;">
          <img src="${escapeHtml(fullCoverUrl)}" alt="${escapeHtml(item.title)}" onerror="this.parentElement.style.display='none'">
          <div class="cover-search-info">
            <div class="cover-search-title">${escapeHtml(item.title)}</div>
            <div class="cover-search-author">${escapeHtml(item.author)}</div>
          </div>
        </div>
      `}).join('')

      $('#coverPreview').innerHTML = `
        <div class="cover-search-list">
          <div class="cover-search-hint">点击选择封面：</div>
          ${resultsHTML}
        </div>
      `

      // 点击选择封面
      $$('.cover-search-result').forEach(result => {
        result.addEventListener('click', () => {
          const coverUrl = result.dataset.coverUrl
          const resultTitle = result.dataset.title
          const resultAuthor = result.dataset.author
          $('#bookCoverUrl').value = coverUrl
          $('#coverPreview').innerHTML = `<img src="${escapeHtml(coverUrl)}" alt="封面预览" onerror="this.style.display='none'">`
          // 如果书名或作者为空，自动填充
          if (!$('#bookTitle').value.trim()) $('#bookTitle').value = resultTitle
          if (!$('#bookAuthor').value.trim()) $('#bookAuthor').value = resultAuthor
          showToast('封面已选择', 'success')
        })
      })

      showToast(`找到 ${data.results.length} 个结果，请选择`, 'success')
    } else {
      showToast('未找到相关书籍封面', 'error')
    }
  } catch (e) {
    showToast('搜索失败，请手动粘贴图片 URL', 'error')
  }

  btn.textContent = '搜索封面'
  btn.disabled = false
}

function saveBook() {
  const title = $('#bookTitle').value.trim()
  if (!title) {
    showToast('请输入书名', 'error')
    return
  }
  const author = $('#bookAuthor').value.trim()
  const coverUrl = $('#bookCoverUrl').value.trim()
  const totalPages = parseInt($('#bookTotalPages').value) || 0
  const currentPage = parseInt($('#bookCurrentPage').value) || 0
  const colorEl = $('#colorPicker .color-option.selected')
  const color = colorEl ? colorEl.dataset.color : BOOK_COLORS[0]

  const books = getBooks()

  if (editingBookId) {
    const book = books.find(b => b.id === editingBookId)
    if (book) {
      Object.assign(book, { title, author, coverUrl, totalPages, currentPage, color })
    }
  } else {
    books.push({
      id: genId(),
      title, author, coverUrl, color,
      totalPages, currentPage: Math.min(currentPage, totalPages),
      createdAt: Date.now()
    })
  }

  saveBooks(books)
  closeModal()
  renderBooks()
  renderNoteFilters()
  renderStatsMini()
  showToast(editingBookId ? '书籍已更新' : '书籍已添加', 'success')
}

function deleteBook(bookId) {
  const book = getBooks().find(b => b.id === bookId)
  if (!book) return
  if (!confirm(`确定要删除「${book.title}」吗？相关的笔记和行动点也会被删除。`)) return

  const books = getBooks().filter(b => b.id !== bookId)
  saveBooks(books)

  // 删除关联笔记
  const notes = getNotes().filter(n => n.bookId !== bookId)
  saveNotes(notes)

  // 删除关联行动
  const actions = getActions().filter(a => a.bookId !== bookId)
  saveActions(actions)

  renderBooks()
  renderNoteFilters()
  renderStatsMini()
  showToast('书籍已删除', 'success')
}

// ===== 笔记管理 =====
function getNotes() {
  return Storage.get('notes', [])
}

function saveNotes(notes) {
  Storage.set('notes', notes)
}

function renderNoteFilters() {
  const books = getBooks()
  const select = $('#noteFilterBook')
  const currentValue = select.value
  select.innerHTML = '<option value="">全部书籍</option>' +
    books.map(b => `<option value="${b.id}">${escapeHtml(b.title)}</option>`).join('')
  select.value = currentValue
}

function renderNotes() {
  const notes = getNotes().sort((a, b) => b.createdAt - a.createdAt)
  const filterBook = $('#noteFilterBook').value
  const filtered = filterBook ? notes.filter(n => n.bookId === filterBook) : notes
  const books = getBooks()
  const bookMap = {}
  books.forEach(b => { bookMap[b.id] = b })

  const list = $('#noteList')

  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="note-empty">
        <div class="empty-state-icon">📝</div>
        <p>还没有笔记，阅读时随手记下摘录和感悟吧</p>
      </div>
    `
    return
  }

  list.innerHTML = filtered.map(note => {
    const book = bookMap[note.bookId]
    const typeConfig = NOTE_TYPES[note.type] || NOTE_TYPES.quote
    return `
      <div class="note-card" data-note-id="${note.id}">
        <div class="note-card-header">
          <div class="note-meta">
            ${book ? `<span class="note-book-tag" style="background: ${book.color}">${escapeHtml(book.title)}</span>` : ''}
            <span class="note-type-tag ${typeConfig.class}">${typeConfig.label}</span>
            ${note.page ? `<span class="note-date">第 ${note.page} 页</span>` : ''}
            <span class="note-date">${formatDate(note.createdAt)}</span>
          </div>
          <div class="note-card-actions">
            <button class="action-icon-btn" onclick="window.app.editNote('${note.id}')" title="编辑">✎</button>
            <button class="action-icon-btn" onclick="window.app.deleteNote('${note.id}')" title="删除">🗑</button>
          </div>
        </div>
        <div class="note-content">${note.type === 'quote' ? '<span class="quote-mark">"</span>' : ''}${escapeHtml(note.content)}${note.type === 'quote' ? '<span class="quote-mark">"</span>' : ''}</div>
        <div class="note-footer">
          <span class="note-action-link" onclick="window.app.extractAction('${note.id}')">→ 从此笔记提炼行动点</span>
        </div>
      </div>
    `
  }).join('')
}

function showNoteForm(noteId = null, presetBookId = null) {
  editingNoteId = noteId
  const books = getBooks()
  if (books.length === 0) {
    showToast('请先添加书籍再记笔记', 'error')
    return
  }

  const note = noteId ? getNotes().find(n => n.id === noteId) : null
  const currentBookId = note ? note.bookId : (presetBookId || books[0].id)

  openModal(note ? '编辑笔记' : '新建笔记', `
    <form id="noteForm" onsubmit="return false">
      <div class="form-group">
        <label class="form-label">书籍 <span class="required">*</span></label>
        <select class="form-select" id="noteBook">
          ${books.map(b => `<option value="${b.id}" ${b.id === currentBookId ? 'selected' : ''}>${escapeHtml(b.title)}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">类型</label>
          <select class="form-select" id="noteType">
            <option value="quote" ${note && note.type === 'quote' ? 'selected' : ''}>摘录</option>
            <option value="insight" ${note && note.type === 'insight' ? 'selected' : ''}>感悟</option>
            <option value="summary" ${note && note.type === 'summary' ? 'selected' : ''}>总结</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">页码</label>
          <input type="number" class="form-input" id="notePage" value="${note ? note.page || '' : ''}" placeholder="可选" min="1">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">内容 <span class="required">*</span></label>
        <textarea class="form-textarea" id="noteContent" placeholder="记下摘录原文、你的感悟或章节总结..." required>${note ? escapeHtml(note.content) : ''}</textarea>
      </div>
      <div class="form-actions">
        <button class="btn btn-secondary" onclick="window.app.closeModal()">取消</button>
        <button class="btn btn-primary" onclick="window.app.saveNote()">保存</button>
      </div>
    </form>
  `)
}

function saveNote() {
  const bookId = $('#noteBook').value
  const type = $('#noteType').value
  const page = parseInt($('#notePage').value) || null
  const content = $('#noteContent').value.trim()

  if (!content) {
    showToast('请输入笔记内容', 'error')
    return
  }

  const notes = getNotes()

  if (editingNoteId) {
    const note = notes.find(n => n.id === editingNoteId)
    if (note) {
      Object.assign(note, { bookId, type, page, content })
    }
  } else {
    notes.push({
      id: genId(),
      bookId, type, page, content,
      createdAt: Date.now()
    })
  }

  saveNotes(notes)
  closeModal()
  renderNotes()
  renderStatsMini()
  showToast(editingNoteId ? '笔记已更新' : '笔记已添加', 'success')
}

function deleteNote(noteId) {
  if (!confirm('确定要删除这条笔记吗？')) return
  const notes = getNotes().filter(n => n.id !== noteId)
  saveNotes(notes)
  renderNotes()
  renderStatsMini()
  showToast('笔记已删除', 'success')
}

function addNoteForBook(bookId) {
  showNoteForm(null, bookId)
}

// ===== 行动管理 =====
function getActions() {
  return Storage.get('actions', [])
}

function saveActions(actions) {
  Storage.set('actions', actions)
}

function renderActions() {
  const actions = getActions().sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 }
    return order[a.priority] - order[b.priority] || b.createdAt - a.createdAt
  })

  const books = getBooks()
  const notes = getNotes()
  const bookMap = {}
  books.forEach(b => { bookMap[b.id] = b })
  const noteMap = {}
  notes.forEach(n => { noteMap[n.id] = n })

  const columns = {
    pending: { el: $('#colPending'), count: 0 },
    doing: { el: $('#colDoing'), count: 0 },
    done: { el: $('#colDone'), count: 0 }
  }

  Object.values(columns).forEach(c => { c.el.innerHTML = ''; c.count = 0 })

  actions.forEach(action => {
    const col = columns[action.status] || columns.pending
    col.count++
    const book = bookMap[action.bookId]
    const note = noteMap[action.noteId]
    const priorityConfig = PRIORITY_CONFIG[action.priority] || PRIORITY_CONFIG.medium

    const card = document.createElement('div')
    card.className = 'action-card'
    card.draggable = true
    card.dataset.actionId = action.id
    card.dataset.status = action.status
    card.innerHTML = `
      <div class="action-card-header">
        <span class="action-priority ${priorityConfig.class}">${priorityConfig.label}优先</span>
        <div class="action-card-actions">
          <button class="action-icon-btn" onclick="window.app.editAction('${action.id}')" title="编辑">✎</button>
          <button class="action-icon-btn" onclick="window.app.deleteAction('${action.id}')" title="删除">🗑</button>
        </div>
      </div>
      <div class="action-title">${escapeHtml(action.title)}</div>
      ${action.description ? `<div class="action-desc">${escapeHtml(action.description)}</div>` : ''}
      <div class="action-source">
        ${book ? `<span class="action-source-tag" style="background: ${book.color}20; color: ${book.color}">${escapeHtml(book.title)}</span>` : ''}
        ${note ? `<span style="color: var(--color-text-muted)">← 笔记</span>` : ''}
        <span style="margin-left: auto; color: var(--color-text-muted)">${formatDate(action.createdAt)}</span>
      </div>
    `

    // 拖拽事件
    card.addEventListener('dragstart', (e) => {
      dragData = action.id
      card.classList.add('dragging')
      e.dataTransfer.effectAllowed = 'move'
    })
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging')
      dragData = null
    })

    col.el.appendChild(card)
  })

  // 更新计数
  $('#countPending').textContent = columns.pending.count
  $('#countDoing').textContent = columns.doing.count
  $('#countDone').textContent = columns.done.count

  // 空状态
  Object.entries(columns).forEach(([status, col]) => {
    if (col.count === 0) {
      col.el.innerHTML = '<div class="action-empty-col">暂无行动点</div>'
    }
  })
}

function showActionForm(actionId = null, presetNoteId = null) {
  editingActionId = actionId
  const books = getBooks()
  const notes = getNotes()
  const action = actionId ? getActions().find(a => a.id === actionId) : null

  // 找到预设笔记
  let presetBookId = ''
  if (presetNoteId) {
    const note = notes.find(n => n.id === presetNoteId)
    if (note) presetBookId = note.bookId
  }

  openModal(action ? '编辑行动点' : '提炼行动点', `
    <form id="actionForm" onsubmit="return false">
      <div class="form-group">
        <label class="form-label">行动标题 <span class="required">*</span></label>
        <input type="text" class="form-input" id="actionTitle" value="${action ? escapeHtml(action.title) : ''}" placeholder="你打算做什么？如：每天早起阅读30分钟" required>
      </div>
      <div class="form-group">
        <label class="form-label">具体描述</label>
        <textarea class="form-textarea" id="actionDesc" placeholder="行动的具体计划、步骤或注意事项..." style="min-height: 80px">${action ? escapeHtml(action.description || '') : ''}</textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">优先级</label>
          <select class="form-select" id="actionPriority">
            <option value="high" ${action && action.priority === 'high' ? 'selected' : ''}>高</option>
            <option value="medium" ${(!action || action.priority === 'medium') ? 'selected' : ''}>中</option>
            <option value="low" ${action && action.priority === 'low' ? 'selected' : ''}>低</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">状态</label>
          <select class="form-select" id="actionStatus">
            <option value="pending" ${(!action || action.status === 'pending') ? 'selected' : ''}>待执行</option>
            <option value="doing" ${action && action.status === 'doing' ? 'selected' : ''}>进行中</option>
            <option value="done" ${action && action.status === 'done' ? 'selected' : ''}>已完成</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">关联书籍</label>
        <select class="form-select" id="actionBook">
          <option value="">不关联</option>
          ${books.map(b => `<option value="${b.id}" ${(action && action.bookId === b.id) || presetBookId === b.id ? 'selected' : ''}>${escapeHtml(b.title)}</option>`).join('')}
        </select>
      </div>
      ${presetNoteId ? `<input type="hidden" id="actionNoteId" value="${presetNoteId}">` : ''}
      <div class="form-actions">
        <button class="btn btn-secondary" onclick="window.app.closeModal()">取消</button>
        <button class="btn btn-primary" onclick="window.app.saveAction()">保存</button>
      </div>
    </form>
  `)
}

function saveAction() {
  const title = $('#actionTitle').value.trim()
  if (!title) {
    showToast('请输入行动标题', 'error')
    return
  }
  const description = $('#actionDesc').value.trim()
  const priority = $('#actionPriority').value
  const status = $('#actionStatus').value
  const bookId = $('#actionBook').value || null
  const noteIdInput = $('#actionNoteId')
  const noteId = noteIdInput ? noteIdInput.value : null

  const actions = getActions()

  if (editingActionId) {
    const action = actions.find(a => a.id === editingActionId)
    if (action) {
      const oldStatus = action.status
      Object.assign(action, { title, description, priority, status, bookId })
      if (noteId) action.noteId = noteId
      if (status === 'done' && oldStatus !== 'done') {
        action.completedAt = Date.now()
      } else if (status !== 'done') {
        action.completedAt = null
      }
    }
  } else {
    actions.push({
      id: genId(),
      title, description, priority, status, bookId,
      noteId: noteId || null,
      source: noteId ? 'note' : 'manual',
      createdAt: Date.now(),
      completedAt: status === 'done' ? Date.now() : null
    })
  }

  saveActions(actions)
  closeModal()
  renderActions()
  renderStatsMini()
  showToast(editingActionId ? '行动点已更新' : '行动点已创建', 'success')
}

function deleteAction(actionId) {
  if (!confirm('确定要删除这个行动点吗？')) return
  const actions = getActions().filter(a => a.id !== actionId)
  saveActions(actions)
  renderActions()
  renderStatsMini()
  showToast('行动点已删除', 'success')
}

function extractAction(noteId) {
  showActionForm(null, noteId)
}

// ===== 拖拽更新状态 =====
function setupDragDrop() {
  $$('.action-column').forEach(col => {
    col.addEventListener('dragover', (e) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      col.classList.add('drag-over')
    })
    col.addEventListener('dragleave', () => {
      col.classList.remove('drag-over')
    })
    col.addEventListener('drop', (e) => {
      e.preventDefault()
      col.classList.remove('drag-over')
      if (!dragData) return
      const newStatus = col.dataset.status
      const actions = getActions()
      const action = actions.find(a => a.id === dragData)
      if (action && action.status !== newStatus) {
        action.status = newStatus
        if (newStatus === 'done') {
          action.completedAt = Date.now()
        } else {
          action.completedAt = null
        }
        saveActions(actions)
        renderActions()
        renderStatsMini()
        const statusLabels = { pending: '待执行', doing: '进行中', done: '已完成' }
        showToast(`已移至「${statusLabels[newStatus]}」`, 'success')
      }
    })
  })
}

// ===== 仪表盘 =====
function renderDashboard() {
  const books = getBooks()
  const notes = getNotes()
  const actions = getActions()

  $('#statBooks').textContent = books.length
  $('#statNotes').textContent = notes.length
  $('#statActions').textContent = actions.length
  $('#statDone').textContent = actions.filter(a => a.status === 'done').length

  // 最近笔记
  const recentNotes = notes.sort((a, b) => b.createdAt - a.createdAt).slice(0, 5)
  const bookMap = {}
  books.forEach(b => { bookMap[b.id] = b })
  $('#recentNotes').innerHTML = recentNotes.length > 0
    ? recentNotes.map(n => {
        const book = bookMap[n.bookId]
        return `
          <div class="recent-item">
            <span class="recent-item-content">
              ${book ? `<span style="color: ${book.color}; font-weight: 600;">${escapeHtml(book.title)}</span> · ` : ''}
              ${escapeHtml(n.content.slice(0, 60))}${n.content.length > 60 ? '...' : ''}
            </span>
            <span class="recent-item-date">${formatDate(n.createdAt)}</span>
          </div>
        `
      }).join('')
    : '<div class="recent-item" style="color: var(--color-text-muted)">暂无笔记</div>'

  // 行动转化率
  const pending = actions.filter(a => a.status === 'pending').length
  const doing = actions.filter(a => a.status === 'doing').length
  const done = actions.filter(a => a.status === 'done').length
  const total = actions.length

  $('#legendPending').textContent = pending
  $('#legendDoing').textContent = doing
  $('#legendDone').textContent = done

  if (total > 0) {
    $('#convPending').style.width = `${(pending / total * 100)}%`
    $('#convDoing').style.width = `${(doing / total * 100)}%`
    $('#convDone').style.width = `${(done / total * 100)}%`
  } else {
    $('#convPending').style.width = '0%'
    $('#convDoing').style.width = '0%'
    $('#convDone').style.width = '0%'
  }

  // 书籍阅读进度
  $('#bookProgressList').innerHTML = books.length > 0
    ? books.map(b => {
        const progress = b.totalPages > 0
          ? Math.min(100, Math.round((b.currentPage / b.totalPages) * 100))
          : 0
        const color = progress === 100 ? 'var(--color-success)' : progress > 50 ? 'var(--color-primary)' : 'var(--color-warning)'
        return `
          <div class="progress-item">
            <span class="progress-item-name" title="${escapeHtml(b.title)}">${escapeHtml(b.title)}</span>
            <div class="progress-item-bar">
              <div class="progress-item-fill" style="width: ${progress}%; background: ${color}"></div>
            </div>
            <span class="progress-item-value">${progress}%</span>
          </div>
        `
      }).join('')
    : '<div style="color: var(--color-text-muted); text-align: center; padding: 20px;">暂无书籍</div>'
}

// ===== 侧边栏迷你统计 =====
function renderStatsMini() {
  const books = getBooks().length
  const notes = getNotes().length
  const actions = getActions().length
  const done = getActions().filter(a => a.status === 'done').length
  $('#statsMini').innerHTML = `
    📚 ${books} 本书 · 📝 ${notes} 条笔记<br>
    ✅ ${done}/${actions} 行动完成
  `
}

// ===== HTML 转义 =====
function escapeHtml(str) {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// ===== 初始化 =====
function init() {
  // 导航绑定
  $$('.nav-item').forEach(item => {
    item.addEventListener('click', () => switchView(item.dataset.view))
  })

  // 按钮绑定
  $('#btnAddBook').addEventListener('click', () => showBookForm())
  $('#btnAddNote').addEventListener('click', () => showNoteForm())
  $('#btnAddAction').addEventListener('click', () => showActionForm())

  // 笔记筛选
  $('#noteFilterBook').addEventListener('change', renderNotes)

  // 模态框关闭
  $('#modalClose').addEventListener('click', closeModal)
  $('#modalOverlay').addEventListener('click', (e) => {
    if (e.target === $('#modalOverlay')) closeModal()
  })

  // ESC 关闭模态框
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal()
  })

  // 拖拽
  setupDragDrop()

  // 首次渲染
  renderBooks()
  renderNoteFilters()
  renderNotes()
  renderActions()
  renderStatsMini()

  // 如果是空数据，插入示例数据
  if (getBooks().length === 0 && getNotes().length === 0 && getActions().length === 0) {
    seedDemoData()
  }
}

// ===== 示例数据 =====
function seedDemoData() {
  const bookId = genId()
  const noteId1 = genId()
  const noteId2 = genId()
  const actionId1 = genId()

  saveBooks([{
    id: bookId,
    title: '原子习惯',
    author: 'James Clear',
    color: '#4f46e5',
    coverUrl: `${proxyBase}/cover-img?url=${encodeURIComponent('https://img3.doubanio.com/view/subject/l/public/s34937323.jpg')}`,
    totalPages: 320,
    currentPage: 85,
    createdAt: Date.now() - 86400000 * 3
  }])

  saveNotes([
    {
      id: noteId1,
      bookId,
      type: 'quote',
      content: '习惯是自我提高的复利。每天进步 1%，一年后你将进步 37 倍。',
      page: 15,
      createdAt: Date.now() - 86400000 * 2
    },
    {
      id: noteId2,
      bookId,
      type: 'insight',
      content: '不要只关注目标，更要关注体系。目标决定了方向，而体系决定了你能走多远。',
      page: 32,
      createdAt: Date.now() - 86400000
    }
  ])

  saveActions([{
    id: actionId1,
    title: '每天早起阅读 30 分钟',
    description: '利用「习惯叠加」方法：早起刷完牙后立即拿起书本阅读 30 分钟。先从微习惯开始，哪怕只读 2 页也好。',
    priority: 'high',
    status: 'doing',
    bookId,
    noteId: noteId1,
    source: 'note',
    createdAt: Date.now() - 86400000,
    completedAt: null
  }])

  renderBooks()
  renderNoteFilters()
  renderNotes()
  renderActions()
  renderStatsMini()
}

// ===== 暴露到全局 =====
window.app = {
  editBook: (id) => showBookForm(id),
  deleteBook: (id) => deleteBook(id),
  addNoteForBook: (id) => addNoteForBook(id),
  editNote: (id) => showNoteForm(id),
  deleteNote: (id) => deleteNote(id),
  editAction: (id) => showActionForm(id),
  deleteAction: (id) => deleteAction(id),
  extractAction: (noteId) => extractAction(noteId),
  saveBook,
  saveNote,
  saveAction,
  closeModal
}

// 启动
init()
