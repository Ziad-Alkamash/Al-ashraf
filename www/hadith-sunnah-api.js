// المصحف الأشرف — طبقة الاتصال بـ API "كتب السنة" (صحيح البخاري، صحيح مسلم،
// رياض الصالحين، سنن أبي داود، سنن النسائي)
// المصدر: api.islamic.app — مرآة كاملة لبيانات sunnah.com، بدون مفتاح API
// وبدون تسجيل، ونتائجها لا تتغيّر بمرور الوقت فيصح تخزينها محليًا لمدة طويلة
// (نفس أسلوب التخزين المحلي المستخدَم في quran-api.js: cachedFetchJSON)
//
// + دعم "تحميل الكتاب كامل للقراءة بدون إنترنت": زر تحميل أمام كل كتاب من
// كتب السنة الخمسة يجيب كل كتبه الفرعية/أبوابه/أحاديثه مرة واحدة ويخزّنها في
// مخزن دائم حقيقي (QuranAudioOffline: Capacitor Filesystem على تطبيق أندرويد/
// آيفون المثبَّت، أو Cache Storage الحقيقي على متصفح/PWA) بدل الاعتماد فقط على
// localStorage — لأن كتابًا واحدًا زي صحيح البخاري ممكن يتجاوز حجمه بسهولة حد
// حصة localStorage المعتادة (٥-١٠ ميجا)، فالتخزين الدائم هو الأصح لضمان بقاء
// الكتاب فعليًا متاحًا بدون إنترنت زي ما وعدنا المستخدم، بنفس الأسلوب المستخدَم
// أصلًا لصفحات المصحف والتلاوات الصوتية
const SunnahAPI = (() => {
  const BASE = 'https://api.islamic.app/v1/hadith';
  const CACHE_PREFIX = 'sunnah-api-cache:';
  const TTL_HOURS = 24 * 365; // نص الحديث لا يتغيّر، فسنة كاملة تخزين آمنة تمامًا

  // اسم المخزن الدائم (فولدره المستقل الخاص به — انظر rootDirFor في
  // quran-audio-offline.js) لبيانات الكتب المحمَّلة كاملة، ومفتاح فهرس صغير
  // في localStorage يوضّح للواجهة فورًا (بدون لمس المخزن الدائم) أي الكتب
  // الخمسة محمَّل فعلًا وكام حديث فيه
  const STORE_NAME = 'sunnah-books-offline-v1';
  const DOWNLOAD_INDEX_KEY = 'sunnah-download-index-v1';
  const LEGACY_FULL_LS_PREFIX = 'sunnah-full-fallback:'; // احتياط فقط لو المخزن الدائم غير متاح إطلاقًا

  // تنظيف مرة واحدة لكاش استجابات الشبكة القديم في localStorage بعد النقل
  // لـ IndexedDB (راجع نفس الشرح في quran-api.js) — البادئة دي كانت مستخدمة
  // فقط لكاش الاستجابات، فمن الآمن مسحها بالكامل
  if (typeof IdbKVCache !== 'undefined') {
    IdbKVCache.purgeLegacyLocalStorageKeys([CACHE_PREFIX]);
  }

  // الكتب الخمسة المتاحة في شاشة "كتب السنة"، بترتيب العرض المطلوب
  const COLLECTIONS = [
    { slug: 'bukhari', name: 'صحيح البخاري', desc: 'أصح كتاب بعد كتاب الله تعالى، جمعه الإمام محمد بن إسماعيل البخاري' },
    { slug: 'muslim', name: 'صحيح مسلم', desc: 'ثاني أصح كتب الحديث، جمعه الإمام مسلم بن الحجاج النيسابوري' },
    { slug: 'riyadussalihin', name: 'رياض الصالحين', desc: 'مختارات جامعة في الآداب والأخلاق والعبادات، للإمام النووي' },
    { slug: 'abudawud', name: 'سنن أبي داود', desc: 'أحد كتب السنن الأربعة، جمعه الإمام أبو داود السجستاني' },
    { slug: 'nasai', name: 'سنن النسائي', desc: 'أحد كتب السنن الأربعة، جمعه الإمام أحمد بن شعيب النسائي' },
  ];

  // جلب مع تخزين محلي (localStorage) — نفس منطق cachedFetchJSON في quran-api.js
  // (يُستخدم أثناء التصفّح العادي أونلاين؛ التحميل الكامل تحت له مساره الخاص
  // عبر المخزن الدائم لأنه أكبر بكتير من حصة localStorage الآمنة)
  async function cachedFetchJSON(url) {
    // منقولة من localStorage لـ IndexedDB لنفس السبب المذكور في quran-api.js:
    // كتب الحديث كتيرة ومتصفَّحة باستمرار، وكانت تكدّس مساحة localStorage
    // المحدودة وتسبب فشل كتابات أخرى غير مرتبطة بصمت
    const cached = await IdbKVCache.get('sunnah-api', url);
    if (cached && Date.now() - cached.t < TTL_HOURS * 3600 * 1000) return cached.v;

    const res = await fetch(url);
    if (!res.ok) throw new Error('تعذر الاتصال بالخادم: ' + res.status);
    const json = await res.json();
    if (!json || json.code !== 200 || typeof json.data === 'undefined') {
      throw new Error('استجابة غير صالحة من الخادم');
    }
    await IdbKVCache.set('sunnah-api', url, json.data);
    return json.data;
  }

  function getCollections() {
    return COLLECTIONS;
  }

  /* ------------------------------------------------------------------ */
  /* فهرس "الكتب المحمَّلة": بيانات صغيرة جدًا (اسم + عدد كتب + عدد أحاديث  */
  /* + تاريخ) في localStorage، يفرّق تمامًا عن البيانات الكاملة نفسها     */
  /* (المخزَّنة في المخزن الدائم) — الهدف إن الواجهة تقدر تعرف فورًا حالة   */
  /* كل كتاب (محمَّل / لأ) من غير ما تضطر تفتح المخزن الدائم كل مرة        */
  /* ------------------------------------------------------------------ */
  function readDownloadIndex() {
    try {
      const raw = localStorage.getItem(DOWNLOAD_INDEX_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  function writeDownloadIndex(idx) {
    try { localStorage.setItem(DOWNLOAD_INDEX_KEY, JSON.stringify(idx)); } catch (e) { /* تجاهل */ }
  }

  function getDownloadInfo(slug) {
    return readDownloadIndex()[slug] || null;
  }

  function isDownloaded(slug) {
    return !!getDownloadInfo(slug);
  }

  function getAllDownloadInfo() {
    return readDownloadIndex();
  }

  function setDownloadInfo(slug, info) {
    const idx = readDownloadIndex();
    idx[slug] = info;
    writeDownloadIndex(idx);
  }

  function clearDownloadInfo(slug) {
    const idx = readDownloadIndex();
    delete idx[slug];
    writeDownloadIndex(idx);
  }

  /* ------------------------------------------------------------------ */
  /* المخزن الدائم (Capacitor Filesystem / Cache Storage عبر               */
  /* QuranAudioOffline) — كل كتاب من الخمسة يُخزَّن كملف JSON واحد كامل     */
  /* (كل كتبه الفرعية + أبوابه + أحاديثه) تحت مفتاح synthetic خاص به        */
  /* ------------------------------------------------------------------ */
  function storeKey(slug) { return 'sunnah-full://' + slug; }

  async function getStore() {
    if (typeof QuranAudioOffline === 'undefined' || !QuranAudioOffline.isSupported || !QuranAudioOffline.isSupported()) return null;
    try { return await QuranAudioOffline.openAudioStore(STORE_NAME); } catch (e) { return null; }
  }

  // كاش في الذاكرة لكل كتاب اتحمّل بياناته الكاملة مرة، عشان أي تنقّل بين
  // الكتب الفرعية/الأبواب بعد كده يبقى فوري من غير أي قراءة تانية من القرص
  const fullCollectionMemo = new Map();

  async function loadFullCollection(slug) {
    if (fullCollectionMemo.has(slug)) return fullCollectionMemo.get(slug);
    const store = await getStore();
    if (store) {
      try {
        const hit = await store.match(storeKey(slug));
        if (hit) {
          const blob = await hit.blob();
          const text = await blob.text();
          const data = JSON.parse(text);
          fullCollectionMemo.set(slug, data);
          return data;
        }
      } catch (e) { /* نكمل للاحتياط تحت */ }
    }
    // احتياط: لو المخزن الدائم مش متاح إطلاقًا (متصفح قديم بلا Cache Storage
    // وبلا Capacitor)، جرّب localStorage — قد يفشل لو الكتاب كبير وده متوقّع
    try {
      const raw = localStorage.getItem(LEGACY_FULL_LS_PREFIX + slug);
      if (raw) {
        const data = JSON.parse(raw);
        fullCollectionMemo.set(slug, data);
        return data;
      }
    } catch (e) { /* تجاهل */ }
    return null;
  }

  function findBookIn(full, bookNumber) {
    if (!full || !full.books) return null;
    return full.books.find((b) => String(b.bookNumber) === String(bookNumber)) || null;
  }

  // كل "كتب" (أقسام) مجموعة حديثية معيّنة، مثال: كتب صحيح البخاري الـ97 —
  // لو الكتاب محمَّل بالكامل نرجّع من النسخة المحلية مباشرة (تشتغل بدون إنترنت)
  async function getBooks(slug) {
    const full = await loadFullCollection(slug);
    if (full) return full.books.map((b) => ({ bookNumber: b.bookNumber, name: b.name, hadithCount: b.hadithCount }));
    return cachedFetchJSON(`${BASE}/collections/${slug}/books`);
  }

  // كل "أبواب" كتاب معيّن جوه مجموعة حديثية
  async function getChapters(slug, bookNumber) {
    const full = await loadFullCollection(slug);
    if (full) {
      const book = findBookIn(full, bookNumber);
      return (book && book.chapters) || [];
    }
    return cachedFetchJSON(
      `${BASE}/collections/${slug}/books/${encodeURIComponent(bookNumber)}/chapters`
    );
  }

  // جلب شبكي مباشر (بدون فحص "هل الكتاب محمَّل بالكامل؟") لكل أحاديث كتاب
  // فرعي معيّن — يُستخدم من التصفّح العادي أونلاين وأيضًا من downloadCollection
  // نفسها (لأنها هي اللي بتبني النسخة الكاملة أصلًا فمينفعش تدور عليها في
  // نفسها). بيعمل أكتر من طلب تصفّح لو عددها تجاوز الحد الأقصى للطلب الواحد
  // (200)، عشان نقدر بعدها نصفّيها محليًا حسب الباب (chapterId)
  async function getAllHadithsInBookNetwork(slug, bookNumber) {
    const limit = 200;
    let offset = 0;
    let all = [];
    let total = Infinity;
    while (offset < total) {
      const page = await cachedFetchJSON(
        `${BASE}/collections/${slug}/books/${encodeURIComponent(bookNumber)}/hadiths?limit=${limit}&offset=${offset}`
      );
      const hadiths = (page && page.hadiths) || [];
      all = all.concat(hadiths);
      total = (page && typeof page.total === 'number') ? page.total : all.length;
      offset += limit;
      if (hadiths.length === 0) break;
    }
    return all;
  }

  async function getAllHadithsInBook(slug, bookNumber) {
    const full = await loadFullCollection(slug);
    if (full) {
      const book = findBookIn(full, bookNumber);
      return (book && book.hadiths) || [];
    }
    return getAllHadithsInBookNetwork(slug, bookNumber);
  }

  /* ------------------------------------------------------------------ */
  /* تحميل كتاب كامل للقراءة بدون إنترنت: كتبه الفرعية ← أبوابه ← كل        */
  /* أحاديثه، دفعة واحدة، مع تقرير تقدّم (كتاب فرعي بكتاب فرعي) للواجهة     */
  /* ------------------------------------------------------------------ */
  // opts: { onProgress({completedBooks, totalBooks, hadithCount}), isCancelled(): bool }
  async function downloadCollection(slug, opts) {
    opts = opts || {};
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : function () {};
    const isCancelled = typeof opts.isCancelled === 'function' ? opts.isCancelled : function () { return false; };

    const rawBooks = await cachedFetchJSON(`${BASE}/collections/${slug}/books`);
    const totalBooks = (rawBooks && rawBooks.length) || 0;
    const fullBooks = [];
    let hadithCount = 0;

    for (let i = 0; i < totalBooks; i++) {
      if (isCancelled()) { const err = new Error('cancelled'); err.cancelled = true; throw err; }
      const b = rawBooks[i];
      let chapters = [];
      try {
        chapters = await cachedFetchJSON(
          `${BASE}/collections/${slug}/books/${encodeURIComponent(b.bookNumber)}/chapters`
        );
      } catch (e) { chapters = []; } // بعض الكتب الفرعية بلا أبواب أصلًا، زي ما بيحصل في التصفّح العادي
      if (isCancelled()) { const err = new Error('cancelled'); err.cancelled = true; throw err; }
      const hadiths = await getAllHadithsInBookNetwork(slug, b.bookNumber);
      fullBooks.push({ bookNumber: b.bookNumber, name: b.name, hadithCount: b.hadithCount, chapters, hadiths });
      hadithCount += hadiths.length;
      onProgress({ completedBooks: i + 1, totalBooks, hadithCount });
    }

    const payload = { slug, downloadedAt: Date.now(), books: fullBooks };
    const json = JSON.stringify(payload);

    const store = await getStore();
    let storedDurably = false;
    if (store) {
      try {
        await store.put(storeKey(slug), new Response(new Blob([json], { type: 'application/json' }), {
          headers: { 'Content-Type': 'application/json' },
        }));
        storedDurably = true;
      } catch (e) { storedDurably = false; }
    }
    if (!storedDurably) {
      // احتياط أخير — قد يفشل بصمت لو الحجم أكبر من حصة localStorage، وهو
      // متوقّع تمامًا لكتب كبيرة زي البخاري ومسلم على متصفح بلا Cache Storage
      try { localStorage.setItem(LEGACY_FULL_LS_PREFIX + slug, json); } catch (e) { /* تجاهل */ }
    }

    fullCollectionMemo.set(slug, payload);
    setDownloadInfo(slug, {
      bookCount: fullBooks.length,
      hadithCount,
      downloadedAt: payload.downloadedAt,
    });
    return payload;
  }

  async function deleteDownloadedCollection(slug) {
    fullCollectionMemo.delete(slug);
    const store = await getStore();
    if (store) { try { await store.delete(storeKey(slug)); } catch (e) { /* تجاهل */ } }
    try { localStorage.removeItem(LEGACY_FULL_LS_PREFIX + slug); } catch (e) { /* تجاهل */ }
    clearDownloadInfo(slug);
  }

  return {
    getCollections,
    getBooks,
    getChapters,
    getAllHadithsInBook,
    downloadCollection,
    deleteDownloadedCollection,
    isDownloaded,
    getDownloadInfo,
    getAllDownloadInfo,
  };
})();
