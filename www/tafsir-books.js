(function (global) {
  'use strict';

  const API = 'https://api.quranpedia.net/v1';
  const CACHE = 'tafsir-books';
  const $ = (selector) => document.querySelector(selector);
  let books = [];
  let readerItems = [];
  let readerPages = [];
  let readerPageIndex = 0;
  let readerSearchQuery = '';
  let searchResults = [];

  function cacheGet(key) {
    return typeof IdbKVCache !== 'undefined' ? IdbKVCache.get(CACHE, key).then((row) => row && row.v) : Promise.resolve(undefined);
  }
  function cacheSet(key, value) {
    return typeof IdbKVCache !== 'undefined' ? IdbKVCache.set(CACHE, key, value) : Promise.resolve();
  }
  async function fetchJSON(url) {
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('تعذّر الاتصال بمكتبة الكتب (' + response.status + ')');
    return response.json();
  }
  async function fetchOfficialBookDump(id) {
    const response = await fetch('https://api.quranpedia.net/dumps/tafsir-book-' + encodeURIComponent(id) + '.json.gz', {
      headers: { Accept: 'application/gzip, application/octet-stream' }
    });
    if (!response.ok) throw new Error('تعذّر تنزيل النسخة المضغوطة (' + response.status + ')');
    if (typeof DecompressionStream === 'undefined') throw new Error('المتصفح لا يدعم فك ضغط ملفات الكتب');
    const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(stream).text());
  }
  function escapeHTML(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function plainText(value) {
    const parsed = new DOMParser().parseFromString(String(value == null ? '' : value), 'text/html');
    return (parsed.body.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function normalizeSearch(value) {
    return String(value || '').toLocaleLowerCase('ar')
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
      .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي');
  }
  function normalizedMap(value) {
    const original = String(value || '');
    let normalized = '';
    const starts = [];
    const ends = [];
    for (let i = 0; i < original.length;) {
      const cp = original.codePointAt(i);
      const char = String.fromCodePoint(cp);
      const end = i + char.length;
      const clean = normalizeSearch(char);
      for (let j = 0; j < clean.length; j++) { normalized += clean[j]; starts.push(i); ends.push(end); }
      i = end;
    }
    return { normalized, starts, ends };
  }
  function textMatchRanges(value, query) {
    const q = normalizeSearch(query);
    if (!q) return [];
    const map = normalizedMap(value);
    const ranges = [];
    let at = 0;
    while ((at = map.normalized.indexOf(q, at)) !== -1) {
      const last = at + q.length - 1;
      ranges.push([map.starts[at], map.ends[last]]);
      at += Math.max(q.length, 1);
    }
    return ranges;
  }
  function safeBookHTML(value, query) {
    const source = String(value == null ? '' : value)
      .replace(/<\/\s*br\s*>/gi, '<br>')
      .replace(/<span\s*\/\s*>/gi, '</span>')
      .replace(/\r?\n/g, '<br>');
    const parsed = new DOMParser().parseFromString(source, 'text/html');
    const allowed = new Set(['BR', 'STRONG', 'B', 'EM', 'I', 'SPAN', 'SUP', 'SUB', 'P', 'DIV', 'UL', 'OL', 'LI']);
    const blocked = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'SVG', 'MATH']);
    function copyChildren(from, to) {
      Array.from(from.childNodes).forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const value = node.nodeValue || '';
          const ranges = textMatchRanges(value, query);
          if (!ranges.length) { to.appendChild(document.createTextNode(value)); return; }
          let offset = 0;
          ranges.forEach(([start, end]) => {
            if (start > offset) to.appendChild(document.createTextNode(value.slice(offset, start)));
            const mark = document.createElement('mark'); mark.textContent = value.slice(start, end); to.appendChild(mark);
            offset = end;
          });
          if (offset < value.length) to.appendChild(document.createTextNode(value.slice(offset)));
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE || blocked.has(node.tagName)) return;
        if (!allowed.has(node.tagName)) { copyChildren(node, to); return; }
        const clean = document.createElement(node.tagName.toLowerCase());
        if (node.tagName === 'SPAN' && node.hasAttribute('class')) {
          const classes = node.getAttribute('class').split(/\s+/).filter((name) => /^[a-z\d_-]{1,40}$/i.test(name));
          if (classes.length) clean.className = classes.join(' ');
        }
        copyChildren(node, clean);
        to.appendChild(clean);
      });
    }
    const safe = document.createElement('div');
    copyChildren(parsed.body, safe);
    return safe.innerHTML;
  }
  function authorName(book) {
    const author = book.author;
    return typeof author === 'string' ? author : (author && (author.ar_name || author.full_name || author.name)) || '';
  }
  function savedIds() {
    try { return new Set(JSON.parse(localStorage.getItem('tafsir-books-saved') || '[]').map(String)); }
    catch (_) { return new Set(); }
  }
  function setSaved(id, saved) {
    const ids = savedIds();
    if (saved) ids.add(String(id)); else ids.delete(String(id));
    try { localStorage.setItem('tafsir-books-saved', JSON.stringify(Array.from(ids))); } catch (_) {}
  }
  function setStatus(message, isError) {
    const el = $('#tafsir-books-status');
    if (el) { el.textContent = message; el.classList.toggle('is-error', !!isError); }
  }
  function normalizeBooks(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.items)) return payload.items.map((row) => row.book_info || row);
    return [];
  }
  function findTafsirCategory(categories) {
    const result = [];
    const walk = (nodes) => (nodes || []).forEach((node) => {
      if (/^التفسير$/.test(String(node.name || '').trim())) result.push(node);
      walk(node.children);
    });
    walk(categories);
    return result.find((item) => Number(item.count) > 0) || result[0];
  }
  async function loadBooks() {
    const cached = await cacheGet('catalogue');
    if (Array.isArray(cached) && cached.length) {
      books = cached;
      renderBooks();
      setStatus('تم عرض الكتب المحفوظة. جارٍ تحديث القائمة…');
    }
    try {
      const categories = await fetchJSON(API + '/categories/books');
      const category = findTafsirCategory(categories);
      if (!category) throw new Error('لم يعثر المصدر على تصنيف كتب التفسير');
      const listed = normalizeBooks(await fetchJSON(API + '/category/' + encodeURIComponent(category.id) + '/books'))
        .filter((book) => book && book.id != null && (!book.type || book.type === 'tafsir'));
      books = listed;
      await cacheSet('catalogue', books);
      renderBooks();
      setStatus('عدد كتب التفسير المتاحة: ' + books.length);
    } catch (error) {
      if (!books.length) setStatus(error.message || 'تعذّر تحميل قائمة الكتب. تحقق من الاتصال بالإنترنت.', true);
      else setStatus('تعذّر تحديث القائمة. يمكنك فتح الكتب التي سبق تحميلها.');
    }
  }
  function renderBooks() {
    const wrap = $('#tafsir-books-list');
    if (!wrap) return;
    const query = ($('#tafsir-books-search') && $('#tafsir-books-search').value || '').trim().toLocaleLowerCase('ar');
    const saved = savedIds();
    const filtered = books.filter((book) => (String(book.name || '') + ' ' + authorName(book)).toLocaleLowerCase('ar').includes(query));
    wrap.innerHTML = filtered.map((book) => {
      const isSaved = saved.has(String(book.id));
      const details = [authorName(book), book.parts ? (book.parts + ' جزء') : '', book.publish_year || ''].filter(Boolean).join(' · ');
      return '<article class="tafsir-book-row" data-book-id="' + escapeHTML(book.id) + '"><span class="settings-card-label"><span class="settings-card-icon clr-6"><svg><use href="#icon-book"></use></svg></span><span class="settings-card-text"><span class="settings-card-title">' + escapeHTML(book.name || 'كتاب تفسير') + '</span><span class="settings-card-sub">' + escapeHTML(details || 'كتاب تفسير قرآني') + '</span></span></span><button type="button" class="tafsir-book-action ' + (isSaved ? 'is-saved' : '') + '" data-book-action="' + (isSaved ? 'open' : 'download') + '" data-book-id="' + escapeHTML(book.id) + '">' + (isSaved ? 'فتح' : 'تحميل') + '</button></article>';
    }).join('');
    if (!filtered.length) wrap.innerHTML = '<p class="tafsir-books-empty">لا توجد كتب مطابقة للبحث.</p>';
  }
  function textFromEntry(entry) {
    if (!entry || typeof entry !== 'object') return '';
    for (const key of ['text', 'content', 'tafsir', 'body', 'value']) {
      if (typeof entry[key] === 'string' && entry[key].trim()) return entry[key].trim();
    }
    return '';
  }
  function flattenContent(payload) {
    const roots = Array.isArray(payload) ? payload : (payload && (payload.content || payload.items || payload.ayahs || payload.data)) || payload;
    const output = [];
    const seen = new Set();
    function visit(node, label) {
      if (!node) return;
      if (Array.isArray(node)) { node.forEach((item) => visit(item, label)); return; }
      if (typeof node === 'string') { if (node.trim()) output.push({ label, text: node.trim() }); return; }
      if (typeof node !== 'object') return;
      const text = textFromEntry(node);
      if (text) {
        const ayahs = node.ayahs || node.ayah || node.reference || node.verse || '';
        const part = node.part ? 'الجزء ' + node.part : '';
        const page = node.page ? 'الصفحة ' + node.page : '';
        const rowLabel = [ayahs ? 'الآيات ' + ayahs : '', part, page].filter(Boolean).join(' · ') || label;
        const key = rowLabel + '|' + text;
        if (!seen.has(key)) { seen.add(key); output.push({ label: rowLabel, text, sourcePage: node.page || null }); }
      }
      Object.keys(node).forEach((key) => {
        const child = node[key];
        if (child && typeof child === 'object') visit(child, /^\d+(?::\d+)?$/.test(key) ? 'الآية ' + key : label);
      });
    }
    visit(roots, '');
    return output;
  }
  function buildReaderPages(items) {
    const pages = [];
    let page = [];
    let chars = 0;
    items.forEach((item) => {
      const size = plainText(item.text).length;
      if (page.length && chars + size > 3000) { pages.push(page); page = []; chars = 0; }
      page.push(item); chars += size;
    });
    if (page.length) pages.push(page);
    return pages;
  }
  function renderReaderPage(direction) {
    const content = $('#tafsir-reader-content');
    const pageItems = readerPages[readerPageIndex] || [];
    const entries = pageItems.map((item) => '<article class="tafsir-reader-entry">' + (item.label ? '<span class="tafsir-reader-reference">' + escapeHTML(item.label) + '</span>' : '') + '<p>' + safeBookHTML(item.text, readerSearchQuery) + '</p></article>').join('');
    content.innerHTML = '<article class="tafsir-page' + (direction ? ' page-turn-' + direction : '') + '"><div class="tafsir-page-content">' + entries + '</div><span class="tafsir-page-number">' + new Intl.NumberFormat('ar').format(readerPageIndex + 1) + '</span></article>';
    $('#tafsir-page-indicator').textContent = 'صفحة ' + new Intl.NumberFormat('ar').format(readerPageIndex + 1) + ' من ' + new Intl.NumberFormat('ar').format(readerPages.length);
    $('#tafsir-page-prev').disabled = readerPageIndex <= 0;
    $('#tafsir-page-next').disabled = readerPageIndex >= readerPages.length - 1;
  }
  function goToPage(index, direction, shouldScroll) {
    if (!readerPages.length) return;
    readerPageIndex = Math.max(0, Math.min(readerPages.length - 1, index));
    renderReaderPage(direction);
    if (shouldScroll) $('#tafsir-reader-content').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function searchBook(query) {
    const summary = $('#tafsir-search-summary');
    const resultsWrap = $('#tafsir-search-results');
    const q = normalizeSearch(query).trim();
    searchResults = [];
    readerSearchQuery = query.trim();
    if (!q) { summary.textContent = ''; resultsWrap.hidden = true; renderReaderPage(); return; }
    readerPages.forEach((page, pageIndex) => page.forEach((item) => {
      const text = plainText(item.text);
      const map = normalizedMap(text);
      let at = 0;
      while ((at = map.normalized.indexOf(q, at)) !== -1) {
        const start = map.starts[at];
        const end = map.ends[at + q.length - 1];
        const from = Math.max(0, start - 45);
        const to = Math.min(text.length, end + 65);
        searchResults.push({ page: pageIndex, label: item.label, snippet: (from ? '…' : '') + text.slice(from, to) + (to < text.length ? '…' : '') });
        at += Math.max(q.length, 1);
      }
    }));
    summary.textContent = searchResults.length ? 'وُجدت ' + new Intl.NumberFormat('ar').format(searchResults.length) + ' نتيجة. اختر موضعًا للانتقال إليه.' : 'لا توجد نتائج لهذه الكلمة.';
    resultsWrap.hidden = !searchResults.length;
    resultsWrap.innerHTML = searchResults.slice(0, 60).map((result, index) => '<button type="button" class="tafsir-search-result" data-result-index="' + index + '"><span>' + (result.label ? escapeHTML(result.label) + ' · ' : '') + 'صفحة ' + new Intl.NumberFormat('ar').format(result.page + 1) + '</span><small>' + escapeHTML(result.snippet) + '</small></button>').join('');
    renderReaderPage();
  }
  function showReader(book, data) {
    readerItems = flattenContent(data);
    readerPages = buildReaderPages(readerItems);
    readerPageIndex = 0;
    readerSearchQuery = '';
    $('#tafsir-books-library').hidden = true;
    $('#tafsir-book-reader').hidden = false;
    $('#tafsir-reader-title').textContent = book.name || 'كتاب التفسير';
    $('#tafsir-reader-meta').textContent = [authorName(book), readerPages.length ? (new Intl.NumberFormat('ar').format(readerPages.length) + ' صفحة') : ''].filter(Boolean).join(' · ');
    $('#tafsir-reader-search').value = '';
    $('#tafsir-search-summary').textContent = '';
    $('#tafsir-search-results').innerHTML = '';
    $('#tafsir-search-results').hidden = true;
    if (!readerItems.length) $('#tafsir-reader-content').innerHTML = '<p class="tafsir-books-empty">تعذّر قراءة بنية محتوى هذا الكتاب. يمكنك فتح الكتاب من موقع المصدر.</p>';
    else renderReaderPage();
  }
  async function downloadBook(id, button) {
    const book = books.find((item) => String(item.id) === String(id));
    if (!book) return;
    button.disabled = true; button.textContent = 'جارٍ التحميل…';
    try {
      let detail = await cacheGet('book-info:' + id);
      if (!detail || !detail.contents_url) {
        detail = await fetchJSON(API + '/book/' + encodeURIComponent(id));
        await cacheSet('book-info:' + id, detail);
      }
      if (!detail.contents_url) throw new Error('لا يتوفر محتوى قابل للتحميل لهذا الكتاب');
      let content;
      let dumpError;
      try {
        content = await fetchOfficialBookDump(id);
      } catch (error) {
        dumpError = error;
        // بعض البيئات القديمة قد لا تدعم ملفات GZIP الرسمية؛ نجرّب رابط
        // المحتوى المباشر المرفق من تفاصيل الكتاب كمسار احتياطي.
        try { content = await fetchJSON(detail.contents_url); }
        catch (fallbackError) {
          const cause = fallbackError && fallbackError.message;
          if (cause === 'Failed to fetch' && location.protocol === 'file:') {
            throw new Error('المتصفح منع الاتصال من ملف محلي. شغّل المشروع عبر خادم محلي (مثل Live Server) ثم أعد المحاولة.');
          }
          if (cause === 'Failed to fetch') throw new Error('تعذّر الوصول إلى خادم Quranpedia. تحقق من الاتصال أو أوقف VPN/مانع الطلبات ثم أعد المحاولة.');
          throw dumpError || fallbackError;
        }
      }
      const readable = flattenContent(content);
      if (!readable.length) throw new Error('وصل محتوى فارغ أو غير مقروء من المصدر');
      await cacheSet('content:' + id, content);
      setSaved(id, true);
      renderBooks();
      setStatus('تم تحميل «' + (book.name || 'الكتاب') + '» وحفظه للقراءة دون اتصال.');
      showReader(book, content);
    } catch (error) {
      button.disabled = false; button.textContent = 'إعادة المحاولة';
      setStatus(error.message || 'تعذّر تحميل الكتاب. حاول مرة أخرى.', true);
    }
  }
  async function openBook(id) {
    const book = books.find((item) => String(item.id) === String(id));
    if (!book) return;
    const data = await cacheGet('content:' + id);
    if (data) { showReader(book, data); return; }
    setSaved(id, false); renderBooks();
    setStatus('نسخة هذا الكتاب غير موجودة على الجهاز. اتصل بالإنترنت لإعادة تحميله.', true);
  }
  function openPage() {
    loadBooks();
  }
  function init() {
    const close = $('#btn-close-tafsir-books');
    if (close) close.addEventListener('click', () => { if (global.closeTafsirBooksOverlay) global.closeTafsirBooksOverlay(); });
    const search = $('#tafsir-books-search'); if (search) search.addEventListener('input', renderBooks);
    const list = $('#tafsir-books-list');
    if (list) list.addEventListener('click', (event) => {
      const button = event.target.closest('[data-book-action]'); if (!button) return;
      if (button.dataset.bookAction === 'open') openBook(button.dataset.bookId);
      else downloadBook(button.dataset.bookId, button);
    });
    const back = $('#tafsir-reader-back');
    if (back) back.addEventListener('click', () => { $('#tafsir-book-reader').hidden = true; $('#tafsir-books-library').hidden = false; });
    const searchInput = $('#tafsir-reader-search');
    if (searchInput) searchInput.addEventListener('input', () => searchBook(searchInput.value));
    const previous = $('#tafsir-page-prev');
    if (previous) previous.addEventListener('click', () => goToPage(readerPageIndex - 1, 'backward', true));
    const next = $('#tafsir-page-next');
    if (next) next.addEventListener('click', () => goToPage(readerPageIndex + 1, 'forward', true));
    const results = $('#tafsir-search-results');
    if (results) results.addEventListener('click', (event) => {
      const button = event.target.closest('[data-result-index]');
      if (!button) return;
      const result = searchResults[Number(button.dataset.resultIndex)];
      if (result) goToPage(result.page, result.page >= readerPageIndex ? 'forward' : 'backward', true);
    });
    const pageSurface = $('#tafsir-reader-content');
    let swipeStart = null;
    if (pageSurface) {
      pageSurface.addEventListener('pointerdown', (event) => {
        swipeStart = event.pointerType === 'touch' ? event.clientX : null;
      }, { passive: true });
      pageSurface.addEventListener('pointerup', (event) => {
        if (swipeStart == null) return;
        const delta = event.clientX - swipeStart;
        swipeStart = null;
        if (delta < -70) goToPage(readerPageIndex + 1, 'forward', false);
        else if (delta > 70) goToPage(readerPageIndex - 1, 'backward', false);
      }, { passive: true });
    }
    document.addEventListener('keydown', (event) => {
      if ($('#tafsir-book-reader').hidden || /INPUT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName)) return;
      if (event.key === 'ArrowLeft') goToPage(readerPageIndex + 1, 'forward', false);
      else if (event.key === 'ArrowRight') goToPage(readerPageIndex - 1, 'backward', false);
    });
  }
  global.openTafsirBooks = openPage;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})(window);
