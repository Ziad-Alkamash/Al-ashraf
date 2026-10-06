/* =========================================================================
   idb-kv-cache.js
   مخزن كاش عام مبني على IndexedDB، بديل مباشر لاستخدام localStorage لتخزين
   استجابات الشبكة القابلة لإعادة التحميل (صفحات القرآن/التفسير/الأحاديث..).

   ليه IndexedDB أفضل هنا بالتحديد:
   - مساحته أكبر بمراحل من localStorage (اللي محدود بـ ٥-١٠ ميجا فقط)، فمش
     بيمتلئ بسهولة مع تراكم صفحات/آيات/أحاديث كتيرة بمرور وقت الاستخدام
     العادي — وده كان السبب الحقيقي وراء فشل كتابات أساسية تانية (زي حفظ
     القارئ الافتراضي وقايمة السور المحمّلة) بصمت لما localStorage يوصل لحده
   - كل عملياته أصلًا async، فمناسب ١٠٠٪ لدالة cachedFetchJSON اللي هي
     async من الأساس — نقل بسيط بدون أي تعديل في نقاط الاستخدام
   - بيدعم مسح العناصر القديمة بفهرس (index) بدل ما نلف يدويًا على كل مفاتيح
     localStorage زي ما كان لازم قبل كده

   الواجهة: get(storeName, key) / set(storeName, key, value) / purgeOlderThan(storeName, maxAgeMs)
   storeName: مساحة اسم منطقية (namespace) بس للتفرقة بين كاش القرآن وكاش
   الحديث مثلًا داخل نفس قاعدة البيانات — لسنا مضطرين لعمل object store مستقل
   لكل نوع، فهرس واحد كافٍ.
   ========================================================================= */
const IdbKVCache = (function (global) {
  'use strict';

  const DB_NAME = 'almus-hraf-kv-cache';
  const DB_VERSION = 1;
  const STORE = 'kv';
  let dbPromise = null;

  function hasIDB() {
    return typeof global.indexedDB !== 'undefined';
  }

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!hasIDB()) { reject(new Error('IndexedDB غير متاح في هذه البيئة')); return; }
      let req;
      try {
        req = global.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'k' });
          store.createIndex('byStoreAndT', ['store', 't']);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  // يرجع {k, store, t, v} أو undefined لو غير موجود — الاستدعاء الفاشل (أي
  // خطأ IndexedDB) بيترجم لـ undefined بدل ما يوقف الكود، فالمستدعي يكمل
  // زي ما لو الكاش فاضي (يجيب من الشبكة تاني، بدون أي كسر في السلوك)
  async function get(storeName, key) {
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(storeName + '::' + key);
        req.onsuccess = () => resolve(req.result || undefined);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      return undefined;
    }
  }

  // تخزين قيمة مع طابع زمني تلقائي (t). فشل الكتابة هنا (نادر جدًا مع
  // IndexedDB، عكس localStorage) بيُتجاهل بصمت لأن الكاش اختياري بطبيعته —
  // أسوأ حالة إن الصفحة تتجاب من الشبكة تاني المرة الجاية بدل الكاش
  async function set(storeName, key, value) {
    try {
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ k: storeName + '::' + key, store: storeName, t: Date.now(), v: value });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) { /* تجاهل — الكاش اختياري */ }
  }

  // مسح كل عناصر namespace معيّن الأقدم من عمر معيّن — تنظيف دوري خفيف
  // اختياري عشان الكاش ما يكبرش من غير حدود مع مرور شهور من الاستخدام
  async function purgeOlderThan(storeName, maxAgeMs) {
    try {
      const db = await openDB();
      const cutoff = Date.now() - maxAgeMs;
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const idx = tx.objectStore(STORE).index('byStoreAndT');
        const range = global.IDBKeyRange.bound([storeName, 0], [storeName, cutoff]);
        const req = idx.openCursor(range);
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) { cursor.delete(); cursor.continue(); }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) { /* تجاهل */ }
  }

  // تنظيف مرة واحدة: مسح مفاتيح كاش الشبكة القديمة اللي كانت متخزنة في
  // localStorage قبل النقل لـ IndexedDB، عشان نرجّع المساحة فورًا للمستخدمين
  // اللي عندهم كاش متراكم من نسخ سابقة (بدل ما يفضل محتل مساحة من غير فايدة
  // لحد ما ينتهي TTL بتاعه، اللي ممكن يوصل لسنة كاملة في بعض الحالات).
  // بنحدد المفاتيح دي بدقة بـ prefix + بادئة ثانية مميزة (http) عشان نتجنب
  // مسح مفاتيح تانية بنفس البادئة الأولى لسه محتاجينها في localStorage
  // (زي فهرس صفحات السور وفهرس التحميل، دول صغار جدًا وسيبناهم عمدًا)
  function purgeLegacyLocalStorageKeys(prefixes) {
    try {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && prefixes.some((p) => k.indexOf(p) === 0)) toRemove.push(k);
      }
      toRemove.forEach((k) => { try { localStorage.removeItem(k); } catch (e) { /* تجاهل */ } });
    } catch (e) { /* تجاهل */ }
  }

  return { get, set, purgeOlderThan, purgeLegacyLocalStorageKeys, isAvailable: hasIDB };
})(typeof window !== 'undefined' ? window : this);
