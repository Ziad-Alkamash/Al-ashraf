/* =========================================================================
   quran-offline.js
   نظام تحميل مكوّنات المصحف (نص + تخطيط + خطوط)
   للعمل الكامل بدون إنترنت، باستخدام Capacitor Filesystem + Capacitor
   Preferences (تخزين حقيقي على الجهاز نفسه).

   *** التحديث المهم في هذه النسخة ***
   قبل كده، زر "تحميل الصفحات" كان بيحمّل نص الآيات بس (604 ملف من
   api.alquran.cloud) ويخزّنها فعليًا. أما رسم مصحف المدينة (QCF4) وخطوطه،
   فقط (أول ما المستخدم يفتح الصفحة فعليًا وهو أونلاين)، وجزء كبير منها
   (كل ملفات الخطوط .woff2 تحديدًا) كان بيعتمد بالكامل على كاش المتصفح
   العادي (HTTP cache) بدل التخزين الدائم عبر Capacitor — وده اللي كان
   بيخلّي التطبيق "يشتغل والنت مفتوح، ويقف لما يتقفل": أي صفحة أو خط لسه
   ما اتفتحش أونلاين قبل كده (أو اتمسح من كاش النظام) بيفضل يحتاج إنترنت.

   دلوقتي زرار التحميل الواحد ده بيحمّل ويخزّن فعليًا (مش مجرد كاش مؤقت):
     ١) نص الآيات (604 صفحة)                    — api.alquran.cloud
     ٢) تخطيط صفحات QCF4 (604 صفحة) لاستخدامات بيانات المصحف
     ٣) خطوط QCF4 اللازمة لعرض الصفحات دون إنترنت.

   الاستخدام من app.js (نفس الواجهة القديمة تمامًا، فمفيش تغيير مطلوب في
   أي كود قديم بينادي عليها):
     await QuranOffline.isDownloaded()       // true/false
     await QuranOffline.download(onProgress) // ينزّل كل حاجة فوق دفعة واحدة
     QuranOffline.cancel()                   // إلغاء التحميل الجاري
     await QuranOffline.readPage(pageNumber)  // نص صفحة (أو null)
     await QuranOffline.reset()              // مسح كل شيء (لإعادة التحميل)

   ودالتان إضافيتان يستخدمهما quran-api.js/app.js لقراءة
   بيانات/خطوط QCF4 بنفس منطق "كاش دائم أول مرة، محلي بعدها":
     await QuranOffline.cacheFetchJSON(url, relPath)
     await QuranOffline.ensureFontCached(url, relPath) // يرجع رابط قابل
                                                        // للاستخدام مباشرة
                                                        // في FontFace
   ========================================================================= */
(function (global) {
  'use strict';

  const QCF4_JSON_BASE = 'https://raw.githubusercontent.com/Ziad-Alkamash/quran-qcf4/main/pages/';
  const QCF4_FONT_BASE = 'https://cdn.jsdelivr.net/gh/Ziad-Alkamash/quran-qcf4@main/fonts-woff2/';
  const QCF4_FONTS = Array.from({ length: 47 }, (_, i) => `QCF4_Hafs_${String(i + 1).padStart(2, '0')}_W.woff2`)
    .concat('QCF4_QBSML.woff2');

  const CONFIG = {
    PAGE_TEXT_URL: (n) => `https://api.alquran.cloud/v1/page/${n}/quran-uthmani`,
    TOTAL_PAGES: 604,
    CONCURRENCY: 5,
    MAX_ATTEMPTS_PER_PAGE: 4,
    REQUEST_TIMEOUT_MS: 45000,
    RETRY_BASE_DELAY_MS: 350,

    // كل صفحة تُحفظ كملف مستقل هنا: Quran/pages/page-001.json ... page-604.json
    ROOT_DIR: 'Quran/pages',
    DIRECTORY: 'DATA', // يقابل Capacitor Directory.Data (تخزين خاص بالتطبيق)

    PREF_DONE_KEY: 'quran_pages_decorated_downloaded_v3',
    PREF_COUNT_KEY: 'quran_pages_file_count',
  };

  function pad3(n) { return String(n).padStart(3, '0'); }

  function OfflineError(msg) { this.name = 'OfflineError'; this.message = msg; }
  OfflineError.prototype = Object.create(Error.prototype);
  function CancelledError(msg) { this.name = 'CancelledError'; this.message = msg; }
  CancelledError.prototype = Object.create(Error.prototype);

  // يرجع {Filesystem, Preferences} فقط لو التطبيق شغّال كتطبيق أندرويد/آيفون
  // حقيقي عبر Capacitor مع تثبيت البلجنين. لو رجع null فالتطبيق شغّال في
  // متصفح عادي، وحينها لا نستخدم هذا النظام إطلاقًا.
  function getPlugins() {
    const cap = global.Capacitor;
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return null;
    const plugins = cap.Plugins || {};
    if (!plugins.Filesystem || !plugins.Preferences) return null;
    return { Filesystem: plugins.Filesystem, Preferences: plugins.Preferences };
  }

  function isNativeReady() { return !!getPlugins(); }

  async function fetchWithTimeout(url, { signal, timeoutMs } = {}) {
    if (global.navigator && global.navigator.onLine === false) {
      throw new OfflineError('لا يوجد اتصال بالإنترنت');
    }
    const ms = timeoutMs || CONFIG.REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    const onParentAbort = () => controller.abort();
    if (signal) signal.addEventListener('abort', onParentAbort);

    let hardTimer;
    const hardTimeout = new Promise((_, reject) => {
      hardTimer = setTimeout(() => reject(new Error('TIMEOUT')), ms + 2000);
    });

    try {
      return await Promise.race([fetch(url, { signal: controller.signal }), hardTimeout]);
    } catch (e) {
      if (signal && signal.aborted) throw new CancelledError('تم إلغاء التحميل');
      if (e && (e.name === 'AbortError' || e.message === 'TIMEOUT')) {
        throw new Error('انتهت مهلة الاتصال، تحقق من سرعة الشبكة');
      }
      throw new OfflineError('تعذّر الاتصال بالإنترنت');
    } finally {
      clearTimeout(timer);
      clearTimeout(hardTimer);
      if (signal) signal.removeEventListener('abort', onParentAbort);
    }
  }

  async function ensureDir(Filesystem, path) {
    try { await Filesystem.mkdir({ path, directory: CONFIG.DIRECTORY, recursive: true }); } catch (e) { /* موجود بالفعل */ }
  }

  // تحويل ArrayBuffer (بيانات خط .woff2 الثنائية) إلى base64 — نفس الصيغة
  // اللي Capacitor Filesystem.writeFile محتاجها لحفظ ملف ثنائي (من غير
  // تمرير encoding: 'utf8'). بنقسّمها على دفعات صغيرة عشان مايحصلش تجاوز
  // لحدّ المعاملات القصوى لـ String.fromCharCode.apply مع الخطوط الأكبر
  function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return (global.btoa || (() => { throw new Error('btoa غير متاح'); }))(binary);
  }

  let currentAbortController = null;
  let currentlyCancelled = false;
  let downloadedStateCache = null;
  let legacyPageSvgCleanupPromise = null;

  // Hafs pages are rendered from QCF4 text/font data now. Remove the 604
  // legacy full-page SVGs left by older versions to reclaim app storage.
  async function clearLegacyPageSvgFiles() {
    const p = getPlugins();
    if (!p) return;
    if (!legacyPageSvgCleanupPromise) {
      legacyPageSvgCleanupPromise = p.Filesystem.rmdir({ path: 'Quran/hafs/images', directory: CONFIG.DIRECTORY, recursive: true })
        .catch(() => { /* لا يوجد مجلد قديم */ });
    }
    await legacyPageSvgCleanupPromise;
  }

  /* ---------------------------------------------------------------- */
  // يرجع مجموعة أسماء الملفات الموجودة فعليًا داخل مجلد معيّن (قراءة واحدة
  // للمجلد كله بدل عمل stat لكل ملف على حدة — أسرع بكثير مع آلاف الملفات).
  // أي خطأ (المجلد غير موجود أصلًا) يُعتبر ببساطة "المجلد فاضي".
  async function getExistingFileSet(Filesystem, dirPath) {
    const set = new Set();
    try {
      const res = await Filesystem.readdir({ path: dirPath, directory: CONFIG.DIRECTORY });
      const entries = (res && res.files) || [];
      for (const entry of entries) {
        const name = typeof entry === 'string' ? entry : (entry && entry.name);
        if (name) set.add(name);
      }
    } catch (e) { /* المجلد غير موجود بعد */ }
    return set;
  }

  // كل مهام التحميل (نص + تخطيط QCF4) كقائمة واحدة موحّدة، كل عنصر فيها:
  // { type: 'json'|'text'|'binary', url, dir, file } — الـ dir/file بيتجمّعوا هنا
  // لسهولة التحقق من "موجود بالفعل على القرص" قبل إعادة تحميله من الأول
  function buildTaskList() {
    const tasks = [];

    for (let n = 1; n <= CONFIG.TOTAL_PAGES; n++) {
      tasks.push({ type: 'json', url: CONFIG.PAGE_TEXT_URL(n), dir: CONFIG.ROOT_DIR, file: `page-${pad3(n)}.json` });
    }

    for (let n = 1; n <= CONFIG.TOTAL_PAGES; n++) {
      const p = pad3(n);
      tasks.push({ type: 'json', url: `${QCF4_JSON_BASE}${p}.json`, dir: 'Quran/qcf4/pages', file: `${p}.json` });
    }

    for (const file of QCF4_FONTS) {
      tasks.push({ type: 'binary', url: `${QCF4_FONT_BASE}${file}`, dir: 'Quran/qcf4/fonts', file });
    }

    return tasks;
  }

  async function buildQcfAyahPagesIndex(Filesystem) {
    const pages = Object.create(null);
    for (let page = 1; page <= CONFIG.TOTAL_PAGES; page++) {
      const path = `Quran/qcf4/pages/${pad3(page)}.json`;
      const stored = await Filesystem.readFile({ path, directory: CONFIG.DIRECTORY, encoding: 'utf8' });
      const data = JSON.parse(stored.data);
      for (const line of data.lines || []) {
        for (const word of line.words || []) {
          if (word.type === 'word' && word.verse_key && !pages[word.verse_key]) pages[word.verse_key] = page;
        }
      }
    }
    await Filesystem.writeFile({
      path: 'Quran/qcf4/ayah-pages.json', data: JSON.stringify(pages),
      directory: CONFIG.DIRECTORY, encoding: 'utf8', recursive: true,
    });
  }

  /* ---------------------------------------------------------------- */
  async function isDownloaded() {
    await clearLegacyPageSvgFiles();
    if (downloadedStateCache === true) return true;
    const p = getPlugins();
    if (!p) return false;
    try {
      const pref = await p.Preferences.get({ key: CONFIG.PREF_DONE_KEY });
      if (pref.value !== 'true') return false;

      // تحقق فعلي من عيّنة ملفات موزّعة على الأقسام (نص + تخطيط QCF4)،
      // وليس فقط تصديق العلامة المخزَّنة، لأن أي حذف جزئي للملفات يجب أن
      // يعيد طلب التحميل (زر "إعادة التحميل" هيكمّل الناقص بس، مش من الأول)
      const samplePaths = [
        `${CONFIG.ROOT_DIR}/page-${pad3(1)}.json`,
        `${CONFIG.ROOT_DIR}/page-${pad3(300)}.json`,
        `${CONFIG.ROOT_DIR}/page-${pad3(CONFIG.TOTAL_PAGES)}.json`,
        `Quran/qcf4/pages/${pad3(1)}.json`,
        `Quran/qcf4/pages/${pad3(CONFIG.TOTAL_PAGES)}.json`,
        'Quran/qcf4/ayah-pages.json',
      ];
      for (const path of samplePaths.concat(QCF4_FONTS.map((file) => `Quran/qcf4/fonts/${file}`))) {
        try {
          await p.Filesystem.stat({ path, directory: CONFIG.DIRECTORY });
        } catch (e) {
          await p.Preferences.remove({ key: CONFIG.PREF_DONE_KEY }).catch(() => {});
          return false;
        }
      }
      downloadedStateCache = true;
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------------------------------------------------------------- */
  async function download(onProgress) {
    await clearLegacyPageSvgFiles();
    return runDownload(buildTaskList, CONFIG.PREF_DONE_KEY, CONFIG.PREF_COUNT_KEY, onProgress);
  }

  async function runDownload(tasksBuilder, doneKey, countKey, onProgress) {
    const p = getPlugins();
    if (!p) throw new Error('هذه الميزة تعمل فقط داخل تطبيق أندرويد/آيفون المثبَّت');
    const { Filesystem, Preferences } = p;
    const progress = typeof onProgress === 'function' ? onProgress : () => {};

    currentlyCancelled = false;
    currentAbortController = new AbortController();

    const STALL_TIMEOUT_MS = 60000;
    let lastProgressAt = Date.now();
    const watchdog = setInterval(() => {
      if (currentlyCancelled || !currentAbortController) return;
      if (Date.now() - lastProgressAt < STALL_TIMEOUT_MS) return;
      lastProgressAt = Date.now();
      const staleController = currentAbortController;
      currentAbortController = new AbortController();
      try { staleController.abort(); } catch (e) { /* تجاهل */ }
    }, 3000);

    try {
      const allTasks = tasksBuilder();

      const neededDirs = Array.from(new Set(allTasks.map((t) => t.dir)));
      const existingSets = {};
      for (const dir of neededDirs) {
        await ensureDir(Filesystem, dir);
        existingSets[dir] = await getExistingFileSet(Filesystem, dir);
      }

      const queue = allTasks.filter((t) => !(existingSets[t.dir] && existingSets[t.dir].has(t.file)));
      const total = allTasks.length;
      let completed = total - queue.length;
      const failedTasks = [];
      progress({ completed, total, failed: 0 });

      function markProgress() { lastProgressAt = Date.now(); }

      async function fetchTaskOnce(task) {
        const path = `${task.dir}/${task.file}`;
        if (task.type === 'image' && global.Capacitor?.Plugins?.FileTransfer && Filesystem.getUri) {
          const uri = await Filesystem.getUri({ path, directory: CONFIG.DIRECTORY });
          await global.Capacitor.Plugins.FileTransfer.downloadFile({
            url: task.url, path: uri.uri, connectTimeout: CONFIG.REQUEST_TIMEOUT_MS,
            headers: { 'User-Agent': 'Mozilla/5.0' },
          });
          return;
        }
        const controllerAtCallTime = currentAbortController;
        const signal = controllerAtCallTime.signal;
        const res = await fetchWithTimeout(task.url, { signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        if (task.type === 'json') {
          const text = await res.text();
          JSON.parse(text);
          await Filesystem.writeFile({
            path, data: text, directory: CONFIG.DIRECTORY, encoding: 'utf8', recursive: true,
          });
        } else if (task.type === 'text' || task.type === 'image') {
          const text = await res.text();
          if (!/<svg[\s>]/i.test(text)) throw new Error('ملف صورة الصفحة غير صالح');
          await Filesystem.writeFile({
            path, data: text, directory: CONFIG.DIRECTORY, encoding: 'utf8', recursive: true,
          });
        } else {
          const buf = await res.arrayBuffer();
          const base64 = arrayBufferToBase64(buf);
          await Filesystem.writeFile({
            path, data: base64, directory: CONFIG.DIRECTORY, recursive: true,
          });
        }
      }

      async function fetchTaskWithRetry(task) {
        for (let attempt = 0; attempt < CONFIG.MAX_ATTEMPTS_PER_PAGE; attempt++) {
          if (currentlyCancelled) return false;
          try {
            await fetchTaskOnce(task);
            return true;
          } catch (e) {
            if (currentlyCancelled) return false;
            if (e instanceof CancelledError && !currentlyCancelled) {
              if (attempt < CONFIG.MAX_ATTEMPTS_PER_PAGE - 1) continue;
              return false;
            }
            if (attempt < CONFIG.MAX_ATTEMPTS_PER_PAGE - 1) {
              await new Promise((r) => setTimeout(r, CONFIG.RETRY_BASE_DELAY_MS * (attempt + 1)));
            } else {
              return false;
            }
          }
        }
        return false;
      }

      async function runQueue(taskList) {
        const localQueue = taskList.slice();
        const localFailed = [];
        async function worker() {
          while (localQueue.length && !currentlyCancelled) {
            const task = localQueue.shift();
            const ok = await fetchTaskWithRetry(task);
            if (ok) completed++; else localFailed.push(task);
            markProgress();
            progress({ completed, total, failed: localFailed.length });
          }
        }
        await Promise.all(Array.from({ length: CONFIG.CONCURRENCY }, worker));
        return localFailed;
      }

      const EXTRA_AUTO_RETRY_ROUNDS = 2;
      failedTasks.push(...(await runQueue(queue)));
      for (let round = 0; round < EXTRA_AUTO_RETRY_ROUNDS && failedTasks.length && !currentlyCancelled; round++) {
        await new Promise((r) => setTimeout(r, 1500));
        const retryBatch = failedTasks.splice(0, failedTasks.length);
        failedTasks.push(...(await runQueue(retryBatch)));
      }

      if (currentlyCancelled) throw new CancelledError('تم إلغاء التحميل');

      if (failedTasks.length > 0) {
        const err = new Error(`تعذّر تحميل ${failedTasks.length} ملف من أصل ${total}. تحقق من اتصالك وأعد المحاولة`);
        err.failedTasks = failedTasks;
        throw err;
      }

      if (doneKey === CONFIG.PREF_DONE_KEY) await buildQcfAyahPagesIndex(Filesystem);

      await Preferences.set({ key: countKey, value: String(total) });
      await Preferences.set({ key: doneKey, value: 'true' });
      if (doneKey === CONFIG.PREF_DONE_KEY) downloadedStateCache = true;
      return { ok: true };
    } finally {
      clearInterval(watchdog);
      currentAbortController = null;
    }
  }

  function cancel() {
    currentlyCancelled = true;
    if (currentAbortController) currentAbortController.abort();
  }

  async function reset() {
    const p = getPlugins();
    if (!p) return;
    try { await p.Filesystem.rmdir({ path: CONFIG.ROOT_DIR, directory: CONFIG.DIRECTORY, recursive: true }); } catch (e) {}
    try { await p.Filesystem.rmdir({ path: 'Quran/qcf4', directory: CONFIG.DIRECTORY, recursive: true }); } catch (e) {}
    try { await p.Filesystem.rmdir({ path: 'Quran/hafs/images', directory: CONFIG.DIRECTORY, recursive: true }); } catch (e) {}
    try { await p.Filesystem.rmdir({ path: 'Quran/ayah-images', directory: CONFIG.DIRECTORY, recursive: true }); } catch (e) {}
    try { await p.Filesystem.rmdir({ path: 'Quran/tajweed', directory: CONFIG.DIRECTORY, recursive: true }); } catch (e) {}
    try { await p.Filesystem.rmdir({ path: 'Quran/warsh', directory: CONFIG.DIRECTORY, recursive: true }); } catch (e) {}
    try { await p.Preferences.remove({ key: CONFIG.PREF_DONE_KEY }); } catch (e) {}
    downloadedStateCache = false;
    try { await p.Preferences.remove({ key: CONFIG.PREF_COUNT_KEY }); } catch (e) {}
    try { await p.Preferences.remove({ key: 'quran_tajweed_downloaded' }); } catch (e) {}
    try { await p.Preferences.remove({ key: 'quran_tajweed_file_count' }); } catch (e) {}
  }

  async function removeLegacyTajweed() {
    const p = getPlugins();
    if (!p) return;
    try { await p.Filesystem.rmdir({ path: 'Quran/tajweed', directory: CONFIG.DIRECTORY, recursive: true }); } catch (e) {}
    try { await p.Preferences.remove({ key: 'quran_tajweed_downloaded' }); } catch (e) {}
    try { await p.Preferences.remove({ key: 'quran_tajweed_file_count' }); } catch (e) {}
  }

  async function readPage(pageNumber) {
    const p = getPlugins();
    if (!p) return null;
    try {
      const res = await p.Filesystem.readFile({
        path: `${CONFIG.ROOT_DIR}/page-${pad3(pageNumber)}.json`,
        directory: CONFIG.DIRECTORY,
        encoding: 'utf8',
      });
      return JSON.parse(res.data);
    } catch (e) {
      return null;
    }
  }

  async function cacheFetchJSON(url, relPath) {
    const p = getPlugins();
    if (!p) {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }
    try {
      const res = await p.Filesystem.readFile({ path: relPath, directory: CONFIG.DIRECTORY, encoding: 'utf8' });
      return JSON.parse(res.data);
    } catch (e) { /* غير محفوظ بعد، نكمل للتحميل تحت */ }

    const res = await fetchWithTimeout(url, {});
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    JSON.parse(text);
    const dir = relPath.substring(0, relPath.lastIndexOf('/'));
    if (dir) await ensureDir(p.Filesystem, dir);
    await p.Filesystem.writeFile({
      path: relPath, data: text, directory: CONFIG.DIRECTORY, encoding: 'utf8', recursive: true,
    });
    return JSON.parse(text);
  }

  async function readStoredJSON(relPath) {
    const p = getPlugins();
    if (!p) return null;
    try {
      const res = await p.Filesystem.readFile({ path: relPath, directory: CONFIG.DIRECTORY, encoding: 'utf8' });
      return JSON.parse(res.data);
    } catch (e) { return null; }
  }

  // Cache one text asset in app storage on first use.
  async function cacheFetchText(url, relPath) {
    const p = getPlugins();
    if (!p) {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }
    try {
      const res = await p.Filesystem.readFile({ path: relPath, directory: CONFIG.DIRECTORY, encoding: 'utf8' });
      return res.data;
    } catch (e) { /* غير محفوظ بعد، نكمل للتحميل تحت */ }

    const res = await fetchWithTimeout(url, {});
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const text = await res.text();
    const dir = relPath.substring(0, relPath.lastIndexOf('/'));
    if (dir) await ensureDir(p.Filesystem, dir);
    await p.Filesystem.writeFile({ path: relPath, data: text, directory: CONFIG.DIRECTORY, encoding: 'utf8', recursive: true });
    return text;
  }

  async function ensureFontCached(url, relPath) {
    const p = getPlugins();
    if (!p) return url;
    try {
      const res = await p.Filesystem.readFile({ path: relPath, directory: CONFIG.DIRECTORY });
      return `data:font/woff2;base64,${res.data}`;
    } catch (e) { /* غير محفوظ بعد، نكمل للتحميل تحت */ }

    const res = await fetchWithTimeout(url, {});
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = await res.arrayBuffer();
    const base64 = arrayBufferToBase64(buf);
    const dir = relPath.substring(0, relPath.lastIndexOf('/'));
    if (dir) await ensureDir(p.Filesystem, dir);
    await p.Filesystem.writeFile({
      path: relPath, data: base64, directory: CONFIG.DIRECTORY, recursive: true,
    });
    return `data:font/woff2;base64,${base64}`;
  }

  global.QuranOffline = {
    CONFIG,
    isNativeReady,
    isDownloaded,
    download,
    cancel,
    reset,
    removeLegacyTajweed,
    readPage,
    cacheFetchJSON,
    readStoredJSON,
    cacheFetchText,
    ensureFontCached,
  };
  // Clean up the obsolete 604-page SVG bundle as soon as the app starts,
  // rather than waiting for the user to open the offline-download screen.
  void clearLegacyPageSvgFiles();
})(window);
