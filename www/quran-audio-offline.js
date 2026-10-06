/* =========================================================================
   quran-audio-offline.js
   بديل لـ Cache Storage لتخزين ملفات الصوت (سور/آيات) باستخدام Capacitor
   Filesystem على تطبيق أندرويد/آيفون المثبَّت (تخزين حقيقي دائم على الجهاز)،
   مع الحفاظ التام على نفس واجهة Cache API (match/put/delete/keys) حتى لا
   يحتاج كود app.js الحالي (تحميل/تشغيل/قوائم السور) أي تعديل في منطقه —
   فقط استبدال `caches.open(NAME)` بـ `QuranAudioOffline.openAudioStore(NAME)`.

   - على تطبيق أندرويد/آيفون الحقيقي (Capacitor): كل الملفات تُخزَّن في
     Quran/audio/ داخل تخزين التطبيق الخاص (Directory.Data)، مع فهرس JSON
     صغير (index.json) يربط كل رابط صوت بامتداد الملف المحلي المقابل له.
   - على متصفح/PWA عادي: يُستخدم Cache Storage الحقيقي كما كان دائمًا، بدون
     أي تغيير في السلوك.
   ========================================================================= */
(function (global) {
  'use strict';

  const DIRECTORY = 'DATA';

  // المجلد الفعلي على القرص لكل اسم كاش. أسماء كاشات الصوت الحالية (المصحف/الأذكار)
  // مثبَّتة على نفس المسار القديم 'Quran/audio' كما كانت دائمًا، حتى لا تنقطع
  // الملفات المُحمَّلة مسبقًا لمستخدمين حاليين. أي اسم كاش جديد (غير صوتي، مثل
  // بيانات كتب السنة المحمَّلة) ياخد مجلده المستقل الخاص به تحت 'Quran/'
  const LEGACY_AUDIO_CACHE_NAMES = ['mushaf-ashraf-audio-v1', 'azkar-audio-cache-v1'];
  function rootDirFor(cacheName) {
    if (LEGACY_AUDIO_CACHE_NAMES.indexOf(cacheName) !== -1) return 'Quran/audio';
    const safe = String(cacheName).replace(/[^a-zA-Z0-9_-]/g, '_');
    return 'Quran/store-' + safe;
  }

  function getPlugins() {
    const cap = global.Capacitor;
    if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) return null;
    const plugins = cap.Plugins || {};
    if (!plugins.Filesystem) return null;
    return { Filesystem: plugins.Filesystem };
  }

  function isNativeReady() { return !!getPlugins(); }

  // Hash نصي بسيط ومستقر لتحويل أي رابط لاسم ملف قصير وصالح على نظام
  // الملفات (الروابط الأصلية فيها / و: و? غير صالحة كأسماء ملفات مباشرة)
  function hashUrl(url) {
    let h = 0;
    for (let i = 0; i < url.length; i++) {
      h = (Math.imul(31, h) + url.charCodeAt(i)) | 0;
    }
    return 'a' + (h >>> 0).toString(16) + '_' + url.length;
  }

  function abToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return global.btoa(binary);
  }

  function base64ToBlob(b64, contentType) {
    const byteChars = global.atob(b64);
    const bytes = new Uint8Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    return new Blob([bytes], { type: contentType || 'audio/mpeg' });
  }

  /* ---------------------------------------------------------------- */
  /* كائن يحاكي Cache API (match/put/delete/keys) لكن مخزَّن فعليًا عبر    */
  /* Capacitor Filesystem — يُستخدم كبديل مباشر لكائن caches.open() القديم */
  /* ---------------------------------------------------------------- */
  function FilesystemCache(Filesystem, rootDir) {
    this.fs = Filesystem;
    this.rootDir = rootDir;
    this.indexFile = `${rootDir}/index.json`;
    this._indexPromise = null;
    this._dirEnsured = false;
    this._writeQueue = Promise.resolve();
    // كاش بسيط في الذاكرة للـ Blobs اللي اتفكّت مسبقًا من base64 — أهم فايدة
    // منه: أول تشغيل لآية بيعمل preload (تحميل مسبق) لآية بعدها في الخلفية
    // (شوف preloadNextAyahAudio في app.js)، فلو ده نفّذ فعك base64→Blob مرة
    // واحدة وحفظه هنا، لما تنتهي الآية الحالية وتحتاج تشغّل الآية اللي
    // اتعمل لها preload، مش هيحتاج يعيد قراءة الملف من التخزين وفكّه من
    // base64 تاني (عملية كانت بتاخد وقت محسوس، وبتتضاعف لمّا الشاشة مقفولة
    // والـ CPU بيبقى أبطأ فالخلفية) — هيلاقيه جاهز فورًا هنا فيبقى الانتقال
    // بين الآيات سريع فعلًا زي ما الـ preload المفروض يحققه أصلًا
    this._blobCache = new Map(); // url -> {blob, contentType}
    this._blobCacheOrder = []; // لترتيب الحذف (الأقدم أولاً) لما الكاش يكبر
    this._BLOB_CACHE_MAX = 6;
  }

  FilesystemCache.prototype._cacheBlob = function (url, blob, contentType) {
    if (!this._blobCache.has(url)) this._blobCacheOrder.push(url);
    this._blobCache.set(url, { blob, contentType });
    while (this._blobCacheOrder.length > this._BLOB_CACHE_MAX) {
      const oldest = this._blobCacheOrder.shift();
      this._blobCache.delete(oldest);
    }
  };

  FilesystemCache.prototype._ensureDir = async function () {
    if (this._dirEnsured) return;
    try { await this.fs.mkdir({ path: this.rootDir, directory: DIRECTORY, recursive: true }); } catch (e) { /* موجود بالفعل */ }
    this._dirEnsured = true;
  };

  FilesystemCache.prototype._loadIndex = async function () {
    try {
      const res = await this.fs.readFile({ path: this.indexFile, directory: DIRECTORY, encoding: 'utf8' });
      return JSON.parse(res.data);
    } catch (e) {
      return {};
    }
  };

  FilesystemCache.prototype._index = function () {
    if (!this._indexPromise) this._indexPromise = this._loadIndex();
    return this._indexPromise;
  };

  FilesystemCache.prototype._saveIndex = async function (idx) {
    await this._ensureDir();
    await this.fs.writeFile({
      path: this.indexFile,
      directory: DIRECTORY,
      data: JSON.stringify(idx),
      encoding: 'utf8',
      recursive: true,
    });
    this._indexPromise = Promise.resolve(idx);
  };

  // يرجع {url, ok:true, blob: async()=>Blob} أو undefined لو غير موجود —
  // بنفس شكل نتيجة cache.match() الحقيقية بقدر ما يحتاجه كود app.js الحالي
  FilesystemCache.prototype.match = async function (url) {
    // لو الملف ده اتفكّ من base64 قبل كده (غالبًا بسبب الـ preload)، رجّع
    // نفس الـ Blob الجاهز فورًا من غير أي قراءة أو فكّ تاني
    const hit = this._blobCache.get(url);
    if (hit) return { url, ok: true, blob: async () => hit.blob };
    const idx = await this._index();
    const entry = idx[url];
    if (!entry) return undefined;
    try {
      const res = await this.fs.readFile({ path: `${this.rootDir}/${entry.file}`, directory: DIRECTORY });
      const blob = base64ToBlob(res.data, entry.contentType);
      this._cacheBlob(url, blob, entry.contentType);
      return { url, ok: true, blob: async () => blob };
    } catch (e) {
      // الملف مفقود رغم وجوده بالفهرس (حذف يدوي/تلف) — ننظّف الفهرس تلقائيًا
      delete idx[url];
      await this._saveIndex(idx).catch(() => {});
      return undefined;
    }
  };

  // يقبل (url, Response) بنفس توقيع cache.put() الحقيقي
  FilesystemCache.prototype.put = function (url, response) {
    const operation = this._writeQueue.then(() => this._put(url, response));
    this._writeQueue = operation.catch(() => {});
    return operation;
  };

  FilesystemCache.prototype._put = async function (url, response) {
    await this._ensureDir();
    const blob = await response.blob();
    const fileName = hashUrl(url) + '.bin';
    const filePath = `${this.rootDir}/${fileName}`;
    // لا نحوّل الملف الصوتي كاملًا إلى ArrayBuffer ثم Base64 دفعة واحدة؛
    // هذا يضاعف الذاكرة عدة مرات ويُسقط تنزيل السور الطويلة على الهواتف.
    // نكتب مقاطع صغيرة متتابعة، مع بقاء الملف غير ظاهر في الفهرس حتى يكتمل.
    try {
      await this.fs.writeFile({ path: filePath, directory: DIRECTORY, data: '', recursive: true });
      // يجب أن يكون حجم كل مقطع (ما عدا الأخير) قابلًا للقسمة على 3 كي لا
      // تفسد علامة padding عند وصل مقاطع Base64 ببعضها.
      const chunkSize = 2 * 1024 * 1024 - 2;
      for (let offset = 0; offset < blob.size; offset += chunkSize) {
        const chunk = await blob.slice(offset, Math.min(offset + chunkSize, blob.size)).arrayBuffer();
        const data = abToBase64(chunk);
        if (offset === 0) {
          await this.fs.writeFile({ path: filePath, directory: DIRECTORY, data, recursive: true });
        } else {
          await this.fs.appendFile({ path: filePath, directory: DIRECTORY, data });
        }
      }
    } catch (error) {
      try { await this.fs.deleteFile({ path: filePath, directory: DIRECTORY }); } catch (e) { /* تجاهل تنظيف ملف ناقص */ }
      const previous = await this._index();
      delete previous[url];
      await this._saveIndex(previous).catch(() => {});
      throw error;
    }

    const idx = await this._index();
    const contentType = (response.headers && response.headers.get && response.headers.get('Content-Type')) || blob.type || 'application/octet-stream';
    idx[url] = { file: fileName, contentType, size: blob.size, t: Date.now() };
    await this._saveIndex(idx);
    this._blobCache.delete(url); // الملف اتغيّر، منسبش نسخة قديمة في الكاش
  };

  FilesystemCache.prototype.delete = function (url) {
    const operation = this._writeQueue.then(() => this._delete(url));
    this._writeQueue = operation.catch(() => {});
    return operation;
  };

  FilesystemCache.prototype._delete = async function (url) {
    const idx = await this._index();
    const entry = idx[url];
    if (!entry) return false;
    try { await this.fs.deleteFile({ path: `${this.rootDir}/${entry.file}`, directory: DIRECTORY }); } catch (e) { /* تجاهل */ }
    delete idx[url];
    await this._saveIndex(idx);
    this._blobCache.delete(url);
    return true;
  };

  // يرجع [{url}, {url}, ...] بنفس شكل نتيجة cache.keys() الحقيقية
  FilesystemCache.prototype.keys = async function () {
    const idx = await this._index();
    return Object.keys(idx).map((u) => ({ url: u }));
  };

  /* ---------------------------------------------------------------- */
  // نقطة الدخول: تُرجع مخزن متوافق مع Cache API — Filesystem على التطبيق
  // المثبَّت، أو Cache Storage الحقيقي على متصفح/PWA عادي (بدون أي تغيير
  // في السلوك القديم هناك)
  const cacheInstances = new Map();
  async function openAudioStore(cacheName) {
    const p = getPlugins();
    if (p) {
      if (!cacheInstances.has(cacheName)) cacheInstances.set(cacheName, new FilesystemCache(p.Filesystem, rootDirFor(cacheName)));
      return cacheInstances.get(cacheName);
    }
    if ('caches' in global) return global.caches.open(cacheName);
    return null;
  }

  function isSupported() {
    return isNativeReady() || ('caches' in global);
  }

  global.QuranAudioOffline = {
    isNativeReady,
    isSupported,
    openAudioStore,
  };
})(window);
