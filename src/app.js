/**
 * 知行 · 应用主逻辑
 * 读书 -> 知识管理 -> 指导行动
 */

import { Storage, genId, formatDate } from './storage.js'

// ===== 封面配置 =====
// 使用 Google Books API 搜索封面（支持跨域）
// 封面图片使用公共 CORS 代理绕过防盗链
const CORS_IMAGE_PROXY = 'https://corsproxy.io/?url='
const GOOGLE_BOOKS_API = 'https://www.googleapis.com/books/v1/volumes'

function getCoverImageUrl(url) {
  if (!url) return null
  // 如果已经是代理 URL，直接返回
  if (url.startsWith('http') && (url.includes('corsproxy.io') || url.includes('allorigins'))) {
    return url
  }
  // 否则使用代理
  return CORS_IMAGE_PROXY + encodeURIComponent(url)
}

// ===== 数据模型 =====
// 书籍: { id, title, author, color, coverUrl, totalPages, currentPage, createdAt, categoryId }
// 笔记: { id, bookId, type('quote'|'insight'|'summary'), content, page, createdAt }
// 行动: { id, title, description, source('manual'|'note'), noteId, bookId, priority('high'|'medium'|'low'), status('pending'|'doing'|'done'), createdAt, completedAt }
// 分类: { id, name, createdAt, sort }

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
let currentCategoryFilter = 'all'

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
  if (viewName === 'books') renderCategoryFilter()
}

// 从笔记跳转到行动看板并高亮目标行动卡片
function jumpToAction(actionId) {
  switchView('actions')
  renderActions()
  // 等渲染完成后高亮目标卡片
  setTimeout(() => {
    const card = document.querySelector(`.action-card[data-action-id="${actionId}"]`)
    if (card) {
      card.classList.add('action-card-highlight')
      card.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // 3秒后移除高亮
      setTimeout(() => card.classList.remove('action-card-highlight'), 3000)
    }
  }, 100)
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

// ===== 分类管理 =====
function getCategories() {
  return Storage.get('categories', []).sort((a, b) => {
    return (a.sort ?? 0) - (b.sort ?? 0) || a.createdAt - b.createdAt
  })
}

function saveCategories(categories) {
  Storage.set('categories', categories)
}

function getCategoryById(id) {
  return getCategories().find(c => c.id === id) || null
}

function getFilteredBooks() {
  const books = getBooks()
  if (currentCategoryFilter === 'all') return books
  if (currentCategoryFilter === 'uncategorized') {
    return books.filter(b => !b.categoryId)
  }
  return books.filter(b => b.categoryId === currentCategoryFilter)
}

function renderCategoryFilter() {
  const books = getBooks()
  const categories = getCategories()
  const bar = $('#categoryBar')
  if (!bar) return

  const countAll = books.length
  const countUncategorized = books.filter(b => !b.categoryId).length

  const tags = [
    { key: 'all', label: '全部', count: countAll },
    { key: 'uncategorized', label: '未分类', count: countUncategorized },
    ...categories.map(c => ({
      key: c.id,
      label: c.name,
      description: c.description,
      count: books.filter(b => b.categoryId === c.id).length
    }))
  ]

  // 分离固定标签和分类标签
  const fixedTags = tags.filter(t => t.key === 'all' || t.key === 'uncategorized')
  const categoryTags = tags.filter(t => t.key !== 'all' && t.key !== 'uncategorized')

  // 渲染固定标签到 header-actions 中
  const fixedTagsContainer = $('#fixedTags')
  if (fixedTagsContainer) {
    fixedTagsContainer.innerHTML = fixedTags.map(t => `
      <span class="category-tag category-tag-fixed ${currentCategoryFilter === t.key ? 'active' : ''}" data-category="${t.key}">
        <span>${escapeHtml(t.label)}</span>
        <span class="category-tag-count">${t.count}</span>
      </span>
    `).join('')
  }

  // 渲染可拖拽分类标签到 category-bar
  bar.innerHTML = categoryTags.map(t => {
    return `
    <span class="category-tag ${currentCategoryFilter === t.key ? 'active' : ''}" data-category="${t.key}" ${t.description ? `title="${escapeHtml(t.description)}"` : ''} draggable="true">
      <span>${escapeHtml(t.label)}</span>
      <span class="category-tag-count">${t.count}</span>
    </span>
  `}).join('') + `
    <span class="category-tag category-tag-add" data-action="add" title="新建分类">+</span>
  `

  // 分类标签拖拽排序
  setupCategoryDragDrop()
}

function setCategoryFilter(key) {
  currentCategoryFilter = key
  renderCategoryFilter()
  renderBooks()
}

// ===== 书籍管理 =====
function getBooks() {
  return Storage.get('books', [])
}

function saveBooks(books) {
  Storage.set('books', books)
}

function renderBooks() {
  const books = getFilteredBooks()
  const grid = $('#bookGrid')

  if (books.length === 0) {
    let emptyText = '书架还是空的，点击「添加书籍」开始阅读之旅吧'
    if (currentCategoryFilter === 'uncategorized') {
      emptyText = '没有未分类的书籍'
    } else if (currentCategoryFilter !== 'all') {
      const cat = getCategoryById(currentCategoryFilter)
      emptyText = cat ? `分类「${cat.name}」下还没有书籍` : emptyText
    }
    grid.innerHTML = `
      <div class="book-empty">
        <div class="book-empty-icon">📚</div>
        <p>${emptyText}</p>
      </div>
    `
    return
  }

  grid.innerHTML = books.map(book => {
    const progress = book.totalPages > 0
      ? Math.min(100, Math.round((book.currentPage / book.totalPages) * 100))
      : 0
    const coverImageUrl = book.coverUrl ? getCoverImageUrl(book.coverUrl) : null
    const coverStyle = coverImageUrl
      ? `background-image: url('${escapeHtml(coverImageUrl)}'); background-size: cover; background-position: center top;`
      : `background: ${book.color};`
    return `
      <div class="book-card${book.coverUrl ? ' book-card-has-cover' : ''}" data-book-id="${book.id}" style="${coverStyle}" data-fallback-color="${book.color}" data-fallback-char="${book.title.charAt(0) || '?'}" draggable="true">
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
            <button class="btn btn-secondary btn-sm book-action-btn" onclick="event.stopPropagation();window.app.editBook('${book.id}')" title="编辑"><span class="btn-icon">✎</span><span class="btn-text">编辑</span></button>
            <button class="btn btn-secondary btn-sm book-action-btn" onclick="event.stopPropagation();window.app.addNoteForBook('${book.id}')" title="记笔记"><span class="btn-icon">＋</span><span class="btn-text">记笔记</span></button>
            <button class="btn btn-danger btn-sm book-action-btn" onclick="event.stopPropagation();window.app.deleteBook('${book.id}')" title="删除"><span class="btn-icon">✕</span><span class="btn-text">删除</span></button>
          </div>
        </div>
      </div>
    `
  }).join('')

  // 点击书卡跳转到该书笔记
  $$('.book-card').forEach(card => {
    card.addEventListener('click', () => {
      // 如果正在拖拽，不执行点击
      if (card.dataset.isDragging === 'true') return
      const bookId = card.dataset.bookId
      $('#noteFilterBook').value = bookId
      switchView('notes')
      renderNotes()
    })
  })

  // 设置书籍拖拽
  setupBookDragDrop()

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

  const categories = getCategories()
  const categoryOptions = '<option value="">未分类</option>' +
    categories.map(c => `<option value="${c.id}" ${book && book.categoryId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')

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
        <label class="form-label">分类</label>
        <select class="form-select" id="bookCategory">${categoryOptions}</select>
      </div>
      <div class="form-group">
        <label class="form-label">封面图片</label>
        <div class="cover-input-row">
          <input type="text" class="form-input" id="bookCoverUrl" value="${book ? escapeHtml(book.coverUrl || '') : ''}" placeholder="粘贴封面图片 URL（可选）" onchange="window.app.updateCoverPreview()">
          <button class="btn btn-secondary" type="button" id="btnSearchCover">搜索封面</button>
        </div>
        <div class="cover-preview" id="coverPreview">${book && book.coverUrl ? `<img src="${escapeHtml(getCoverImageUrl(book.coverUrl))}" alt="封面预览" onerror="this.style.display='none'">` : ''}</div>
        <div class="form-hint">输入书名后点击「搜索封面」自动查找，或直接粘贴图片 URL</div>
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
  // 封面预览更新
  $('#bookCoverUrl')?.addEventListener('input', updateCoverPreview)
}

// 通过 Google Books API 搜索封面
async function searchBookCover() {
  const title = $('#bookTitle').value.trim()
  const author = $('#bookAuthor').value.trim()
  if (!title) {
    showToast('请先输入书名', 'error')
    return
  }

  const btn = $('#btnSearchCover')
  btn.textContent = '搜索中...'
  btn.disabled = true

  try {
    // 构建查询参数
    const query = author ? `${title} ${author}` : title
    const resp = await fetch(`${GOOGLE_BOOKS_API}?q=${encodeURIComponent(query)}&maxResults=6&langRestrict=zh-CN,en`)

    if (!resp.ok) {
      throw new Error(`搜索失败: ${resp.status}`)
    }

    const data = await resp.json()

    if (data.items && data.items.length > 0) {
      // 展示多个搜索结果供用户选择
      const resultsHTML = data.items.slice(0, 6).map(item => {
        const volumeInfo = item.volumeInfo
        const coverUrl = volumeInfo.imageLinks?.thumbnail || volumeInfo.imageLinks?.smallThumbnail
        if (!coverUrl) return ''

        const displayTitle = volumeInfo.title
        const displayAuthor = volumeInfo.authors?.join(', ') || '未知作者'
        const previewUrl = getCoverImageUrl(coverUrl)

        return `
          <div class="cover-search-result" data-cover-url="${escapeHtml(coverUrl)}" data-title="${escapeHtml(displayTitle)}" data-author="${escapeHtml(displayAuthor)}" style="cursor: pointer;">
            <img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(displayTitle)}" onerror="this.parentElement.style.display='none'">
            <div class="cover-search-info">
              <div class="cover-search-title">${escapeHtml(displayTitle)}</div>
              <div class="cover-search-author">${escapeHtml(displayAuthor)}</div>
            </div>
          </div>
        `
      }).filter(html => html).join('')

      if (resultsHTML) {
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
            $('#coverPreview').innerHTML = `<img src="${escapeHtml(getCoverImageUrl(coverUrl))}" alt="封面预览" onerror="this.style.display='none'">`
            // 如果书名或作者为空，自动填充
            if (!$('#bookTitle').value.trim()) $('#bookTitle').value = resultTitle
            if (!$('#bookAuthor').value.trim()) $('#bookAuthor').value = resultAuthor
            showToast('封面已选择', 'success')
          })
        })

        showToast(`找到 ${data.items.length} 个结果，请选择`, 'success')
      } else {
        showToast('未找到相关书籍封面', 'error')
      }
    } else {
      showToast('未找到相关书籍封面', 'error')
    }
  } catch (e) {
    console.error('搜索封面失败:', e)
    showToast('搜索失败，请手动粘贴图片 URL', 'error')
  }

  btn.textContent = '搜索封面'
  btn.disabled = false
}

function updateCoverPreview() {
  const url = $('#bookCoverUrl')?.value.trim()
  const preview = $('#coverPreview')
  if (!preview) return
  if (url) {
    preview.innerHTML = `<img src="${escapeHtml(getCoverImageUrl(url))}" alt="封面预览" onerror="this.style.display='none'">`
  } else {
    preview.innerHTML = ''
  }
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
  const categoryId = $('#bookCategory').value || null

  const books = getBooks()

  if (editingBookId) {
    const book = books.find(b => b.id === editingBookId)
    if (book) {
      Object.assign(book, { title, author, coverUrl, totalPages, currentPage, color, categoryId })
    }
  } else {
    books.push({
      id: genId(),
      title, author, coverUrl, color,
      totalPages, currentPage: Math.min(currentPage, totalPages),
      createdAt: Date.now(),
      categoryId
    })
  }

  saveBooks(books)
  closeModal()
  renderBooks()
  renderCategoryFilter()
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
  renderCategoryFilter()
  renderNoteFilters()
  renderStatsMini()
  showToast('书籍已删除', 'success')
}

// ===== 分类管理模态框 =====
function showCategoryManageModal() {
  openModal('管理分类', `
    <div id="categoryManageContainer"></div>
    <div class="category-manage-hint">
      提示：删除分类后，该分类下的书籍会变为「未分类」，书籍本身不会被删除。
    </div>
  `)
  renderCategoryManageList()
}

function renderCategoryManageList() {
  const categories = getCategories()
  const books = getBooks()
  const container = $('#categoryManageContainer')
  if (!container) return

  const listHTML = categories.length === 0
    ? '<div class="category-manage-empty">还没有分类，在下方输入名称创建一个吧</div>'
    : categories.map(c => `
      <div class="category-manage-item" data-category-id="${c.id}">
        <div class="category-manage-info">
          <span class="category-manage-name">${escapeHtml(c.name)}</span>
          ${c.description ? `<span class="category-manage-desc" title="${escapeHtml(c.description)}">${escapeHtml(c.description)}</span>` : ''}
        </div>
        <span class="category-manage-count">${books.filter(b => b.categoryId === c.id).length} 本书</span>
        <div class="category-manage-actions">
          <button class="btn btn-secondary btn-sm" data-action="rename" data-id="${c.id}">编辑</button>
          <button class="btn btn-danger btn-sm" data-action="delete" data-id="${c.id}">删除</button>
        </div>
      </div>
    `).join('')

  container.innerHTML = `
    <div class="category-manage-list" id="categoryManageList">${listHTML}</div>
    <div class="category-manage-add-row">
      <input type="text" class="form-input" id="newCategoryName" placeholder="分类名称（如：认知思维）" maxlength="20">
      <input type="text" class="form-input" id="newCategoryDesc" placeholder="分类描述（鼠标悬停时显示）" maxlength="100">
      <button class="btn btn-primary" id="btnCreateCategory">新建</button>
    </div>
  `

  $('#btnCreateCategory').addEventListener('click', createCategoryFromInput)
  $('#newCategoryName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createCategoryFromInput()
  })
  $('#categoryManageList').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]')
    if (!btn) return
    const action = btn.dataset.action
    const id = btn.dataset.id
    if (action === 'rename') startRenameCategory(id)
    if (action === 'delete') deleteCategory(id)
  })
}

function createCategoryFromInput() {
  const input = $('#newCategoryName')
  const descInput = $('#newCategoryDesc')
  if (!input) return
  const name = input.value.trim()
  if (!name) { showToast('请输入分类名称', 'error'); return }
  const description = descInput ? descInput.value.trim() : ''
  createCategory(name, description)
  input.value = ''
  if (descInput) descInput.value = ''
}

function createCategory(name, description = '') {
  const categories = getCategories()
  if (categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
    showToast('该分类已存在', 'error')
    return
  }
  categories.push({
    id: genId(),
    name,
    description,
    createdAt: Date.now(),
    sort: categories.length
  })
  saveCategories(categories)
  renderCategoryManageList()
  renderCategoryFilter()
  showToast('分类已创建', 'success')
}

function startRenameCategory(id) {
  const item = document.querySelector(`.category-manage-item[data-category-id="${id}"]`)
  if (!item) return
  const cat = getCategoryById(id)
  if (!cat) return
  item.innerHTML = `
    <div class="category-manage-edit-form">
      <input type="text" class="category-manage-input" id="renameInput_${id}" value="${escapeHtml(cat.name)}" placeholder="分类名称" maxlength="20">
      <input type="text" class="category-manage-input" id="renameDesc_${id}" value="${escapeHtml(cat.description || '')}" placeholder="分类描述（鼠标悬停时显示）" maxlength="100">
    </div>
    <div class="category-manage-actions">
      <button class="btn btn-primary btn-sm" data-action="save-rename" data-id="${id}">保存</button>
      <button class="btn btn-secondary btn-sm" data-action="cancel-rename" data-id="${id}">取消</button>
    </div>
  `
  const input = $(`#renameInput_${id}`)
  input.focus()
  input.select()
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doRenameCategory(id)
    if (e.key === 'Escape') renderCategoryManageList()
  })
  item.querySelector('[data-action="save-rename"]').addEventListener('click', () => doRenameCategory(id))
  item.querySelector('[data-action="cancel-rename"]').addEventListener('click', renderCategoryManageList)
}

function doRenameCategory(id) {
  const input = $(`#renameInput_${id}`)
  const descInput = $(`#renameDesc_${id}`)
  if (!input) return
  const name = input.value.trim()
  if (!name) { showToast('分类名称不能为空', 'error'); return }
  const description = descInput ? descInput.value.trim() : ''
  const categories = getCategories()
  if (categories.some(c => c.id !== id && c.name.toLowerCase() === name.toLowerCase())) {
    showToast('该分类已存在', 'error')
    return
  }
  const cat = categories.find(c => c.id === id)
  if (cat) {
    cat.name = name
    cat.description = description
    saveCategories(categories)
    renderCategoryManageList()
    renderCategoryFilter()
    showToast('分类已重命名', 'success')
  }
}

function deleteCategory(id) {
  const cat = getCategoryById(id)
  if (!cat) return
  const count = getBooks().filter(b => b.categoryId === id).length
  const msg = count > 0
    ? `确定要删除分类「${cat.name}」吗？该分类下的 ${count} 本书将变为「未分类」。`
    : `确定要删除分类「${cat.name}」吗？`
  if (!confirm(msg)) return

  const categories = getCategories().filter(c => c.id !== id)
  saveCategories(categories)

  const books = getBooks()
  let changed = false
  books.forEach(b => {
    if (b.categoryId === id) { b.categoryId = null; changed = true }
  })
  if (changed) saveBooks(books)

  if (currentCategoryFilter === id) currentCategoryFilter = 'all'

  renderCategoryManageList()
  renderCategoryFilter()
  renderBooks()
  showToast('分类已删除', 'success')
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

  // 构建笔记→行动点映射
  const actions = getActions()
  const actionsByNoteId = {}
  actions.forEach(a => {
    if (a.noteId) {
      if (!actionsByNoteId[a.noteId]) actionsByNoteId[a.noteId] = []
      actionsByNoteId[a.noteId].push(a)
    }
  })

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
          ${(actionsByNoteId[note.id] || []).map(a => {
            const statusIcon = a.status === 'done' ? '✓ ' : a.status === 'doing' ? '◐ ' : ''
            return `<span class="note-action-derived" onclick="window.app.jumpToAction('${a.id}')" title="点击跳转到行动看板">${statusIcon}${escapeHtml(a.title)}</span>`
          }).join('')}
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

// ===== 分类标签拖拽排序 =====
let categoryDragData = null

function setupCategoryDragDrop() {
  $$('.category-tag[draggable="true"]').forEach(tag => {
    tag.addEventListener('dragstart', (e) => {
      categoryDragData = tag.dataset.category
      tag.classList.add('category-dragging')
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', categoryDragData)
    })

    tag.addEventListener('dragend', () => {
      tag.classList.remove('category-dragging')
      categoryDragData = null
      $$('.category-tag').forEach(t => t.classList.remove('category-drag-over'))
    })

    tag.addEventListener('dragover', (e) => {
      e.preventDefault()
      if (tag.dataset.category === categoryDragData) return
      tag.classList.add('category-drag-over')
      e.dataTransfer.dropEffect = 'move'
    })

    tag.addEventListener('dragleave', () => {
      tag.classList.remove('category-drag-over')
    })

    tag.addEventListener('drop', (e) => {
      e.preventDefault()
      tag.classList.remove('category-drag-over')
      if (!categoryDragData || categoryDragData === tag.dataset.category) return

      const fromId = categoryDragData
      const toId = tag.dataset.category

      // 获取所有分类并重新排序
      const categories = getCategories()
      const fromIndex = categories.findIndex(c => c.id === fromId)
      const toIndex = categories.findIndex(c => c.id === toId)

      if (fromIndex === -1 || toIndex === -1) return

      // 移动分类
      const [movedCategory] = categories.splice(fromIndex, 1)
      categories.splice(toIndex, 0, movedCategory)

      // 更新 sort 字段
      categories.forEach((c, i) => c.sort = i)

      saveCategories(categories)
      renderCategoryFilter()
    })
  })
}

// ===== 书籍卡片拖拽排序 =====
let bookDragData = null

function setupBookDragDrop() {
  $$('.book-card[draggable="true"]').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      bookDragData = card.dataset.bookId
      card.classList.add('book-dragging')
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', bookDragData)
      // 拖拽时阻止点击事件
      card.dataset.isDragging = 'true'
    })

    card.addEventListener('dragend', () => {
      card.classList.remove('book-dragging')
      bookDragData = null
      $$('.book-card').forEach(c => {
        c.classList.remove('book-drag-over')
        delete c.dataset.isDragging
      })
    })

    card.addEventListener('dragover', (e) => {
      e.preventDefault()
      if (card.dataset.bookId === bookDragData) return
      card.classList.add('book-drag-over')
      e.dataTransfer.dropEffect = 'move'
    })

    card.addEventListener('dragleave', () => {
      card.classList.remove('book-drag-over')
    })

    card.addEventListener('drop', (e) => {
      e.preventDefault()
      card.classList.remove('book-drag-over')
      if (!bookDragData || bookDragData === card.dataset.bookId) return

      const fromId = bookDragData
      const toId = card.dataset.bookId

      // 获取当前筛选条件下的书籍
      const allBooks = getBooks()
      const filteredBooks = getFilteredBooks()

      const fromIndex = filteredBooks.findIndex(b => b.id === fromId)
      const toIndex = filteredBooks.findIndex(b => b.id === toId)

      if (fromIndex === -1 || toIndex === -1) return

      // 在所有书籍数组中找到对应位置并调整排序
      const fromBook = allBooks.find(b => b.id === fromId)
      const toBook = allBooks.find(b => b.id === toId)

      if (!fromBook || !toBook) return

      // 在 allBooks 中移动书籍
      const fromIndexAll = allBooks.findIndex(b => b.id === fromId)
      allBooks.splice(fromIndexAll, 1)

      // 计算插入位置：如果向左拖，插入到目标位置；向右拖，插入到目标后一个位置
      const toIndexAll = allBooks.findIndex(b => b.id === toId)
      if (fromIndex < toIndex) {
        // 向右拖，插入到目标后
        allBooks.splice(toIndexAll + 1, 0, fromBook)
      } else {
        // 向左拖，插入到目标前
        allBooks.splice(toIndexAll, 0, fromBook)
      }

      saveBooks(allBooks)
      renderBooks()
    })
  })
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
  $('#btnManageCategories').addEventListener('click', showCategoryManageModal)

  // 分类标签栏事件代理
  $('#categoryBar').addEventListener('click', (e) => {
    const tag = e.target.closest('.category-tag')
    if (!tag) return
    if (tag.dataset.action === 'add') {
      showCategoryManageModal()
      setTimeout(() => $('#newCategoryName')?.focus(), 100)
      return
    }
    const key = tag.dataset.category
    if (key) setCategoryFilter(key)
  })

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
  renderCategoryFilter()
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
  const categories = [
    { id: 'cat1', name: '认知思维', description: '提升认知、建立思维模型，看清世界的底牌', sort: 0, createdAt: Date.now() - 86400000 * 10 },
    { id: 'cat2', name: '逻辑表达', description: '想得清楚、说得明白，把话说得让人一眼看懂', sort: 1, createdAt: Date.now() - 86400000 * 9 },
    { id: 'cat3', name: '沟通关系', description: '把话说清楚不伤人，经营值得靠近的关系', sort: 2, createdAt: Date.now() - 86400000 * 8 },
    { id: 'cat4', name: '心理成长', description: '与自己和解，理解自己为什么痛、怕、逃避', sort: 3, createdAt: Date.now() - 86400000 * 7 },
    { id: 'cat5', name: '写作创作', description: '用文字搭建思想体系，让内容有传播力', sort: 4, createdAt: Date.now() - 86400000 * 6 },
    { id: 'cat6', name: '财富思维', description: '重新认识钱，让金钱成为工具而非主人', sort: 5, createdAt: Date.now() - 86400000 * 5 },
    { id: 'cat7', name: '文学励志', description: '在别人的故事里看见自己，活出不一样的人生；也涵盖给疲惫灵魂留一片栖息地的心灵滋养类书', sort: 6, createdAt: Date.now() - 86400000 * 4 },
    { id: 'cat8', name: '历史人文', description: '往深处看，才能往远处走，太阳底下没有新鲜事', sort: 7, createdAt: Date.now() - 86400000 * 3 }
  ]

  const catIds = {}
  categories.forEach(c => catIds[c.name] = c.id)

  saveCategories(categories)

  const bookId = genId()
  const noteId1 = genId()
  const noteId2 = genId()
  const actionId1 = genId()

  saveBooks([{
    id: bookId,
    title: '原子习惯',
    author: 'James Clear',
    color: '#4f46e5',
    coverUrl: 'https://img3.doubanio.com/view/subject/l/public/s34937323.jpg',
    totalPages: 320,
    currentPage: 85,
    createdAt: Date.now() - 86400000 * 3,
    categoryId: catIds['认知思维']
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

  renderCategoryFilter()
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
  jumpToAction: (actionId) => jumpToAction(actionId),
  updateCoverPreview,
  saveBook,
  saveNote,
  saveAction,
  closeModal,
  manageCategories: showCategoryManageModal,
  setCategoryFilter,
  createCategory,
  deleteCategory
}

// 启动
init()
