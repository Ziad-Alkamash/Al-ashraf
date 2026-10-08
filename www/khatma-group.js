// الأشرف — ميزة "الختمة الجماعية" (منفصلة عن app.js عشان تفضل قابلة
// للصيانة لوحدها). بتستخدم Firebase (خطة Spark المجانية: Firestore +
// Anonymous Auth بس، من غير أي Cloud Functions مدفوعة)، ومنطق الحجز/الإتمام
// كله بيتنفّذ من جوّه التطبيق عن طريق Firestore Transactions، والحماية من
// الغش مسؤولية قواعد الأمان (Firestore Security Rules) — راجع ملف
// firestore.rules المرفق، ولصقه في Firebase Console → Firestore → Rules.
(() => {
  'use strict';

  const B = window.AppBridge;
  if (!B) { console.error('khatma-group.js: AppBridge غير متاح، تأكد إن app.js اتحمّل قبله'); return; }
  const { $, $$, jumpToPage, switchToTab, openOverlay, closeOverlay, showToast,
          tUI, toArabicDigits, escapeHTML, getLocalNotifPlugin, initDragToClose,
          JUZ_START_PAGES, KHATMA_TOTAL_PAGES, surahNameForPage, recordLastKhatmaOpened } = B;

  const T = (key, fallback) => tUI(key, fallback);

  /* ================================================================== */
  /* 1) Firebase: تهيئة + هوية مجهولة + اسم القراءة المحفوظ محليًا        */
  /* ================================================================== */
  const PROFILE_KEY = 'almus-hraf:kgProfile';
  const OP_TIMEOUT_MS = 20000; // مستخدم برّه firestore-rest.js بس لأي عملية تانية لو احتجنا
  const FS = window.FirestoreLite; // Firestore + Auth عن طريق REST API عادي (fetch)، بدل الـ SDK
  let myUid = null;
  let fbReady = false;
  let fbInitError = null;

  // ================================================================
  // كود الاسترجاع: بيربط باسورد داخلي (مش شايفه المستخدم) بنفس الحساب
  // المجهول الحالي، عشان لو التطبيق اتمسح (أو بياناته) نقدر "نرجع" لنفس
  // الـ uid بمجرد تسجيل دخول عادي بيه — فترجع كل الختمات الجماعية اللي
  // كان فيها أو منشئها (هي مخزّنة بالـ uid في Firestore أصلًا). الختمات
  // الفردية محفوظة محليًا بس (IndexedDB) فمش بترجع، وده مقصود.
  // الكود نفسه = "KHR1." + uid + "." + سرّ عشوائي طويل، وبيتولّد مرة واحدة
  // بس لكل حساب (أول ما يتعمل بروفايل)، وما بيتخزّنش على السيرفر كنص صريح
  // (بيتحفظ كباسورد Firebase Auth عادي، مُشفّر عند جوجل زي أي باسورد).
  const RECOVERY_PREFIX = 'KHR1';
  const RECOVERY_EMAIL_DOMAIN = 'khatma-recovery.local';
  const RECOVERY_LOCAL_KEY = 'almus-hraf:kgRecoveryCode';
  const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  function emailForUid(uid) { return `u${String(uid || '').toLowerCase()}@${RECOVERY_EMAIL_DOMAIN}`; }
  function makeRecoverySecret(len) {
    len = len || 24;
    let out = '';
    const hasCrypto = window.crypto && window.crypto.getRandomValues;
    const buf = hasCrypto ? window.crypto.getRandomValues(new Uint32Array(len)) : null;
    for (let i = 0; i < len; i++) {
      const n = hasCrypto ? buf[i] : Math.floor(Math.random() * 4294967296);
      out += RECOVERY_ALPHABET[n % RECOVERY_ALPHABET.length];
    }
    return out;
  }
  function buildRecoveryCode(uid, secret) { return `${RECOVERY_PREFIX}.${uid}.${secret}`; }
  // بيتقبل لصق فيه مسافات/أسطر جديدة زيادة من غير ما يرفضه
  function parseRecoveryCode(raw) {
    const clean = String(raw || '').trim().replace(/\s+/g, '');
    const parts = clean.split('.');
    if (parts.length !== 3 || parts[0].toUpperCase() !== RECOVERY_PREFIX) return null;
    const uid = parts[1], secret = parts[2];
    if (!uid || !secret || secret.length < 10) return null;
    return { uid, secret };
  }
  function loadLocalRecoveryCode() {
    try { return localStorage.getItem(RECOVERY_LOCAL_KEY) || ''; } catch (e) { return ''; }
  }
  function saveLocalRecoveryCode(code) {
    try { localStorage.setItem(RECOVERY_LOCAL_KEY, code); } catch (e) { /* تجاهل */ }
  }

  function getMyName() {
    try { return (JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}').name) || ''; } catch (e) { return ''; }
  }
  function setMyName(name) {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify({ name })); } catch (e) { /* تجاهل */ }
  }

  // فلاج محلي: هل المستخدم خلّص شاشة "الترحيب" (اسم + عرض الـ ID) أول مرة
  // فتح فيها صفحة الختمة؟ شوف kgMaybeShowOnboarding تحت
  const ONBOARDED_KEY = 'almus-hraf:kgOnboarded';
  function hasOnboarded() {
    try { return localStorage.getItem(ONBOARDED_KEY) === '1'; } catch (e) { return false; }
  }
  function markOnboarded() {
    try { localStorage.setItem(ONBOARDED_KEY, '1'); } catch (e) { /* تجاهل */ }
  }

  function initFirebase() {
    if (!window.FIREBASE_KHATMA_CONFIG || !FS) {
      fbInitError = 'missing-sdk';
      return Promise.resolve(false);
    }
    try { FS.init(window.FIREBASE_KHATMA_CONFIG); } catch (e) { fbInitError = 'init-failed'; return Promise.resolve(false); }
    return FS.ensureAuthed().then(() => {
      myUid = FS.uid;
      fbReady = true;
      return true;
    }).catch((err) => {
      fbInitError = err; // نسيب الخطأ الحقيقي زي ما هو (بكوده ونصه)
      return false;
    });
  }

  // كل عملية Firestore بتمر من هنا أولًا: بتتأكد إن فيه إنترنت وهوية جاهزة،
  // وبتترجم أي فشل لنص عربي مفهوم بدل ما ترمي استثناء تقني للمستخدم
  async function ensureReady() {
    if (!navigator.onLine) throw new Error('offline');
    if (fbReady) return true;
    const ok = await initFirebase();
    if (!ok) {
      // fbInitError ممكن يبقى نص بسيط ('missing-sdk') أو كائن خطأ حقيقي
      // من Auth (بكوده الكامل زي auth/requests-from-referer-...)
      throw (fbInitError && typeof fbInitError === 'object') ? fbInitError : new Error(fbInitError || 'not-ready');
    }
    return true;
  }

  function friendlyError(e) {
    const msg = String((e && e.message) || e || '');
    const code = String((e && e.code) || '');
    // بنسجّل الخطأ الحقيقي في الكونسول دايمًا (مهم للتشخيص لو المشكلة في
    // إعداد Firebase نفسه — شوف Chrome DevTools → chrome://inspect وقت
    // توصيل الموبايل بالكمبيوتر، أو Logcat)
    console.error('[khatma-group]', e);
    if (msg === 'offline') return T('khatma_group.err_offline', 'يلزم الاتصال بالإنترنت لإتمام العملية');
    if (msg === 'timeout') return T('khatma_group.err_timeout', 'الاتصال بطيء جدًا أو متوقف، يرجى التأكد من الإنترنت والمحاولة مرة أخرى');
    if (msg === 'missing-sdk') return T('khatma_group.err_sdk', 'تعذّر تحميل خدمة الختمة الجماعية، تأكد من الإنترنت وأعد فتح التطبيق');
    if (msg === 'not-found') return T('khatma_group.err_not_found', 'لا توجد ختمة بهذا الكود');
    if (msg === 'user-not-found') return T('khatma_group.err_user_not_found', 'لا يوجد أحد بهذا الـ ID، يرجى التأكد من صحته');
    if (msg === 'expired') return T('khatma_group.err_expired', 'انتهى موعد هذه الختمة');
    if (msg === 'taken') return T('khatma_group.err_taken', 'تم حجز هذا الجزء للتو، يرجى اختيار جزء آخر');
    if (msg === 'not-admin') return T('khatma_group.err_not_admin', 'هذه الصلاحية مخصصة لمنشئ الختمة فقط');
    if (msg === 'recovery-code-invalid') return T('khatma_group.err_recovery_invalid', 'كود الاسترجاع غير صحيح، تأكد إنك نسخته كامل من غير أي نقص');
    if (msg === 'recovery-not-configured') return T('khatma_group.err_recovery_off', 'ميزة استرجاع الختمات الجماعية غير مفعّلة على السيرفر بعد') + (code ? ' — [' + code + ']' : '');
    if (code === 'permission-denied') return T('khatma_group.err_rules', 'لم يتم إعداد قواعد الأمان في Firebase Console بعد (firestore.rules)') + (msg ? ' — [' + msg + ']' : '');
    if (code === 'unavailable' || code === 'failed-precondition') return T('khatma_group.err_unavailable', 'تعذّر الوصول لقاعدة البيانات، تأكد من أنك أنشأت Firestore Database في Firebase Console');
    if (code.indexOf('auth/requests-from-referer') === 0 || code === 'auth/unauthorized-domain') {
      return T('khatma_group.err_referrer', 'مفتاح Firebase مقيّد بدومينات معيّنة، وهذا يمنع التطبيق (APK) تحديدًا — يرجى إزالة القيد من Google Cloud Console ← Credentials');
    }
    if (code === 'auth/api-key-not-valid' || code === 'auth/invalid-api-key') {
      return T('khatma_group.err_apikey', 'مفتاح Firebase (apiKey) غير صحيح أو تم إلغاؤه');
    }
    if (code === 'auth/network-request-failed') {
      return T('khatma_group.err_authnet', 'تعذّر الوصول لخدمة تسجيل الدخول، تأكد من الإنترنت على هاتفك المحمول');
    }
    if (code === 'auth/invalid-user-token') {
      return T('khatma_group.err_authexpired', 'انتهت صلاحية الجلسة، يرجى المحاولة مرة أخرى');
    }
    // كود/رسالة مش متعرّف عليها — نعرضها زي ما هي عشان تبقى قابلة للتشخيص
    return T('khatma_group.err_generic', 'حدث خطأ') + ' (' + (code || msg || '؟') + ')';
  }

  /* ================================================================== */
  /* 2) أدوات صغيرة                                                     */
  /* ================================================================== */
  const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // بدون 0/O/1/I لتفادي اللبس
  function makeInviteCode() {
    let out = '';
    for (let i = 0; i < 6; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    return out;
  }
  function unitLabel(unitType, n) {
    return unitType === 'page'
      ? T('khatma_group.page_word', 'صفحة {n}').replace('{n}', toArabicDigits(n))
      : T('khatma_group.juz_word', 'الجزء {n}').replace('{n}', toArabicDigits(n));
  }
  function unitStartPage(unitType, n) {
    return unitType === 'page' ? n : JUZ_START_PAGES[n - 1];
  }
  function unitEndPage(unitType, n) {
    if (unitType === 'page') return n;
    return n < 30 ? JUZ_START_PAGES[n] - 1 : KHATMA_TOTAL_PAGES;
  }
  function fmtDate(ms) {
    if (!ms) return '';
    try { return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch (e) { return ''; }
  }
  function fmtTime(ms) {
    if (!ms) return '';
    try { return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  }

  /* ================================================================== */
  /* 3) طبقة البيانات (Firestore) — كل عملية Transaction لمنع تعارض      */
  /*    الحجز بين اثنين في نفس اللحظة، زي ما هو مطلوب بالظبط              */
  /* ================================================================== */
  const COL = 'khatmaGroups';
  const STALE_CLAIM_MS = 7 * 24 * 60 * 60 * 1000; // أسبوع بدون إتمام يفكّ الحجز لأي عضو تاني

  async function createGroupKhatma({ title, privacy, unitType, endDate, continuous }) {
    await ensureReady();
    const name = getMyName();
    const unitCount = unitType === 'page' ? KHATMA_TOTAL_PAGES : 30;
    const now = Date.now();
    const isContinuous = !!continuous;
    const doc = {
      title: title || T('khatma_group.default_title', 'ختمة جماعية'),
      creatorId: myUid,
      creatorName: name,
      type: privacy === 'public' ? 'public' : 'private',
      unitType,
      unitCount,
      inviteCode: makeInviteCode(),
      status: 'active',
      // الختمة المستمرة مالهاش تاريخ انتهاء خالص — تفضل شغّالة وتبدأ دورة
      // جديدة تلقائيًا كل ما تكتمل (شوف completeUnit)
      endDate: isContinuous ? null : (endDate || null),
      continuous: isContinuous,
      roundsCompleted: 0,
      createdAt: now,
      lastActivityAt: now,
      completedAt: null,
      completedCount: 0,
      memberUids: [myUid],
      members: { [myUid]: { name, joinedAt: now } },
      units: {},
      requireApproval: true, // الانضمام يحتاج موافقة المنشئ (يقدر يقفلها من قائمة الأعضاء)
      pending: {}
    };
    const ref = await FS.addDoc(COL, doc);
    return { id: ref.id, ...doc };
  }

  async function findByCode(code) {
    await ensureReady();
    const clean = String(code || '').trim().toUpperCase();
    const rows = await FS.runQuery(COL, [{ field: 'inviteCode', op: 'EQUAL', value: clean }], 1);
    if (!rows.length) throw new Error('not-found');
    return { id: rows[0].id, data: rows[0].data };
  }

  // بيرجّع { id, status } — status: 'joined' (اتضاف فورًا) أو 'pending' (طلب انضمام مستني موافقة المنشئ)
  async function joinByCode(code) {
    await ensureReady();
    const { id, data } = await findByCode(code);
    if (data.status !== 'active') throw new Error('expired');
    if (data.memberUids && data.memberUids.includes(myUid)) return { id, status: 'joined' }; // منضم بالفعل
    const name = getMyName();
    if (data.requireApproval) {
      if (data.pending && data.pending[myUid]) return { id, status: 'pending' }; // طلبي لسه مستني
      const res = await FS.runTransaction(COL, id, async (d) => {
        if (!d) throw new Error('not-found');
        if (d.status !== 'active') throw new Error('expired');
        if ((d.memberUids || []).includes(myUid)) return { result: 'joined' };
        const pending = d.pending || {};
        pending[myUid] = { name, requestedAt: Date.now() };
        return { patch: { pending, lastActivityAt: Date.now() }, result: 'pending' };
      });
      return { id, status: res === 'joined' ? 'joined' : 'pending' };
    }
    await FS.runTransaction(COL, id, async (d) => {
      if (!d) throw new Error('not-found');
      if (d.status !== 'active') throw new Error('expired');
      const members = d.members || {};
      members[myUid] = { name, joinedAt: Date.now() };
      const memberUids = Array.from(new Set([...(d.memberUids || []), myUid]));
      return { patch: { members, memberUids, lastActivityAt: Date.now() } };
    });
    return { id, status: 'joined' };
  }

  // -------- طلبات الانضمام (للمنشئ بس) --------
  async function approveRequest(khatmaId, uid) {
    await ensureReady();
    await FS.runTransaction(COL, khatmaId, async (d) => {
      if (!d) throw new Error('not-found');
      if (d.creatorId !== myUid) throw new Error('not-admin');
      const pending = d.pending || {};
      const req = pending[uid];
      if (!req) return null; // اتعالج بالفعل
      delete pending[uid];
      const members = d.members || {};
      members[uid] = { name: req.name || '', joinedAt: Date.now() };
      const memberUids = Array.from(new Set([...(d.memberUids || []), uid]));
      return { patch: { pending, members, memberUids, lastActivityAt: Date.now() } };
    });
  }
  async function rejectRequest(khatmaId, uid) {
    await ensureReady();
    await FS.runTransaction(COL, khatmaId, async (d) => {
      if (!d) throw new Error('not-found');
      if (d.creatorId !== myUid) throw new Error('not-admin');
      const pending = d.pending || {};
      if (!pending[uid]) return null;
      delete pending[uid];
      return { patch: { pending, lastActivityAt: Date.now() } };
    });
  }
  async function setRequireApproval(khatmaId, value) {
    await ensureReady();
    await FS.updateDoc(COL, khatmaId, { requireApproval: !!value, lastActivityAt: Date.now() });
  }

  async function listMyGroups() {
    await ensureReady();
    const rows = await FS.runQuery(COL, [{ field: 'memberUids', op: 'ARRAY_CONTAINS', value: myUid }]);
    return rows.map((r) => ({ id: r.id, ...r.data })).sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0));
  }

  async function listPublicGroups() {
    await ensureReady();
    const rows = await FS.runQuery(COL, [{ field: 'type', op: 'EQUAL', value: 'public' }], 40);
    return rows.map((r) => ({ id: r.id, ...r.data }))
      .filter((k) => k.status === 'active')
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  /* ================================================================== */
  /* 3.5) بروفايل المستخدم: id ثابت دائم + اسم قابل للتعديل                */
  /*      الـ id ده مستقل تمامًا عن أي هوية Firebase تقنية (uid) وعن       */
  /*      localStorage — هو مخزّن في مستند users/{uid} على السيرفر، فحتى   */
  /*      لو localStorage اتمسح، أي حد يقدر يرجّع بروفايله طالما الـ uid   */
  /*      التقني ثابت (وده مضمون دلوقتي بعد تصحيح firestore-rest.js).      */
  /*      المستخدم بيقدر كمان يحفظ/يبعت الـ id ده لحد تاني بره التطبيق،    */
  /*      فمش محتاج حتى يرجع لنفس الجهاز عشان حد يضيفه لختمة.              */
  /* ================================================================== */
  const USERS_COL = 'users';
  const USER_CODE_LEN = 8; // أطول من كود دعوة الختمة (٦) لأنه هوية دائمة
  function makeUserCode() {
    let out = '';
    for (let i = 0; i < USER_CODE_LEN; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    return out;
  }
  function normalizeUserCode(code) {
    return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  let myProfileCache = null; // { code, name } — بعد أول تحميل في الجلسة دي
  // بيرجّع بروفايلي: لو عندي مستند users/{uid} خلاص بيرجّعه زي ما هو
  // (الـ code السيرفري هو المرجع الوحيد، مش أي حاجة محفوظة محليًا)، ولو
  // أول مرة، بيولّد id جديد ويسجّله مرة واحدة وبس.
  async function getOrCreateMyProfile(forceRefresh) {
    await ensureReady();
    if (myProfileCache && !forceRefresh) return myProfileCache;
    const existing = await FS.getDoc(USERS_COL, myUid);
    if (existing && existing.code) {
      myProfileCache = { code: existing.code, name: existing.name || getMyName() || '' };
      return myProfileCache;
    }
    const code = makeUserCode();
    const name = getMyName() || '';
    let hasRecoveryKey = false;
    // نربط كود استرجاع من أول ما البروفايل بيتعمل (مرة واحدة بس). لو فشل
    // (مثلًا مزوّد البريد/الباسورد لسه مش مفعّل في Firebase Console) منوقّفش
    // إنشاء البروفايل أصلًا عشان كده — بس المستخدم مش هيقدر يسترجع بعدين
    let recoveryCode = '';
    try {
      const secret = makeRecoverySecret();
      await FS.linkPassword(emailForUid(myUid), secret);
      recoveryCode = buildRecoveryCode(myUid, secret);
      saveLocalRecoveryCode(recoveryCode);
      hasRecoveryKey = true;
    } catch (e) { console.error('[khatma-group] تعذّر ربط كود الاسترجاع', e); }
    await FS.updateDoc(USERS_COL, myUid, { code, name, createdAt: Date.now(), hasRecoveryKey });
    myProfileCache = { code, name, hasRecoveryKey, recoveryCode };
    return myProfileCache;
  }

  // بيرجّع كود الاسترجاع المحفوظ محليًا على الجهاز ده (لو موجود) — مبنيش
  // على السيرفر خالص لأن الباسورد الحقيقي مش قابل للاسترجاع منه أصلًا،
  // بس مخزّن محليًا وقت أول إنشاء له عشان "بروفايلي" يقدر يوريه تاني
  function getMyRecoveryCode() { return loadLocalRecoveryCode(); }

  // بيولّد كود استرجاع جديد (وبيلغي أي كود قديم كان شغّال) — يفيد لو
  // المستخدم مسح الكود القديم بالغلط أو عايز يجدّده لأي سبب
  async function regenerateRecoveryCode() {
    await ensureReady();
    const secret = makeRecoverySecret();
    try {
      await FS.linkPassword(emailForUid(myUid), secret);
    } catch (e) {
      // نت الموبايل أحيانًا بيدّي بطء/انقطاع لحظي (مش عطل حقيقي) عند أول
      // طلب بس — نجرّب مرة واحدة تانية قبل ما نعرض "الإنترنت ضعيف" للمستخدم
      if (e && (e.message === 'timeout' || (e.code || '') === 'auth/network-request-failed')) {
        await new Promise((r) => setTimeout(r, 900));
        await FS.linkPassword(emailForUid(myUid), secret);
      } else {
        throw e;
      }
    }
    const code = buildRecoveryCode(myUid, secret);
    saveLocalRecoveryCode(code);
    if (myProfileCache) { myProfileCache.hasRecoveryKey = true; myProfileCache.recoveryCode = code; }
    else { await FS.updateDoc(USERS_COL, myUid, { hasRecoveryKey: true }); }
    return code;
  }

  // بترجّع { hadGroups } قبل ما تبدأ عملية الاسترجاع الفعلية — بتستخدمها
  // الواجهة عشان تنبّه المستخدم لو كان عنده ختمات جماعية على الحساب الحالي
  // (الجديد) هيفقد وصوله ليها لو كمّل استرجاع كود قديم (استبدال كامل للحساب)
  async function currentAccountHasGroups() {
    try {
      await ensureReady();
      const rows = await listMyGroups();
      return rows.length > 0;
    } catch (e) { return false; }
  }

  // الاسترجاع الفعلي: بيسجّل دخول بنفس البريد/الباسورد الداخليين المرتبطين
  // بالكود، فيرجع بالحساب (uid) القديم بالظبط، وبالتالي كل الختمات الجماعية
  // المرتبطة بيه في Firestore (منشئها أو منضم فيها) بترجع تلقائيًا —
  // مفيش أي تعديل على أي مستند ختمة هنا خالص، إحنا بس رجّعنا نفس الهوية
  async function restoreFromRecoveryCode(rawCode) {
    const parsed = parseRecoveryCode(rawCode);
    if (!parsed) throw new Error('recovery-code-invalid');
    if (!navigator.onLine) throw new Error('offline');
    // بس نتأكد إن FS مهيّأ (apiKey/projectId)، من غير ما نعمل تسجيل دخول
    // مجهول جديد الأول (مفيش داعي، هنستبدله فورًا بتسجيل الدخول بالباسورد)
    if (!FS.apiKey || !FS.projectId) {
      if (!window.FIREBASE_KHATMA_CONFIG) throw new Error('missing-sdk');
      FS.init(window.FIREBASE_KHATMA_CONFIG);
    }
    await FS.signInWithPassword(emailForUid(parsed.uid), parsed.secret);
    myUid = FS.uid;
    fbReady = true;
    myProfileCache = null;
    const profile = await getOrCreateMyProfile(true);
    if (profile && profile.name) setMyName(profile.name);
    saveLocalRecoveryCode(String(rawCode || '').trim().replace(/\s+/g, ''));
    markOnboarded();
    // بتاعت الحساب "الجديد" اللي هنسيبه (كانت أصلًا فاضية غالبًا) — عشان
    // ما تفضلش عالقة وتظهر لحظة قبل ما البيانات الصحيحة (بتاعة الحساب
    // القديم المسترجَع) توصل بعد الـ reload
    try {
      localStorage.removeItem('almus-hraf:kgReadingSession');
      localStorage.removeItem('almus-hraf:kgLastKnown');
      localStorage.removeItem('almus-hraf:kgRoundsSeen');
      localStorage.removeItem('almus-hraf:kgCelebrated');
    } catch (e) { /* تجاهل */ }
    return profile;
  }

  async function updateMyProfileName(newName) {
    await ensureReady();
    const profile = await getOrCreateMyProfile();
    await FS.updateDoc(USERS_COL, myUid, { name: newName });
    profile.name = newName;
    setMyName(newName); // نفس التخزين المحلي المستخدم في باقي التطبيق
    // ونعمل sync لاسمي في كل الختمات الجماعية المنضم فيها، زي بالظبط تعديل
    // الاسم من جوه ختمة (نفس السلوك، بس من مكان مركزي واحد)
    syncNameToOtherGroups(newName, null).catch(() => {});
    return profile;
  }

  /* ================================================================== */
  /* شاشة "الترحيب": أول ما المستخدم يفتح صفحة الختمة في حياته، بنطلب منه   */
  /* اسمه (هيتطبّق على كل ختماته زي حساب واحد)، وبعد ما يحفظه بنوريله الـ    */
  /* ID الثابت بتاعه عشان يبقى عارفه، وبعدين نسيبه يشوف صفحة الختمة عادي.  */
  /* ================================================================== */

  // بترجّع true لو المفروض نعرض شاشة الترحيب دلوقتي (أول مرة فعلًا، ومفيش
  // اسم محفوظ خالص) — بتتنادى من app.js لحظة فتح تبويب "الختمة"
  function kgShouldShowOnboarding() {
    if (hasOnboarded()) return false;
    // لو المستخدم عنده اسم محفوظ بالفعل (مثلًا من نسخة قديمة من التطبيق
    // قبل ما شاشة الترحيب دي تتضاف، أو دخل من قبل على ختمة جماعية وحفظ
    // اسمه من نافذة "اسمك" القديمة) مفيش داعي نجبره يعمل حاجة تاني
    if (getMyName()) { markOnboarded(); return false; }
    return true;
  }

  function kgOpenOnboarding() {
    openOverlay('#khatma-onboarding-overlay');
    $('#kg-onboarding-step-id').classList.add('hidden');
    $('#kg-onboarding-step-name').classList.remove('hidden');
    $('#kg-onboarding-name-input').value = '';
    setTimeout(() => { try { $('#kg-onboarding-name-input').focus(); } catch (e) { /* تجاهل */ } }, 200);
  }

  // بعد ما المستخدم يحفظ اسمه: نروح لخطوة عرض الـ ID، ونحاول نجيبه من
  // السيرفر في الخلفية (محتاج نت + هوية Firebase). لو فشلت (مفيش نت مثلًا)
  // منوقفش المستخدم عندها — بنوريله رسالة بسيطة ونسيبه يكمل عادي، والـ ID
  // هيبان له بعدين من "بروفايلي" أول ما يتصل بالنت
  function kgGoOnboardingIdStep() {
    $('#kg-onboarding-step-name').classList.add('hidden');
    $('#kg-onboarding-step-id').classList.remove('hidden');
    const idEl = $('#kg-onboarding-id-text');
    idEl.textContent = '••••••••';
    $('#kg-onboarding-recovery-block').classList.add('hidden');
    getOrCreateMyProfile(true).then((profile) => {
      idEl.textContent = profile.code;
      if (profile.recoveryCode) {
        $('#kg-onboarding-recovery-text').textContent = profile.recoveryCode;
        $('#kg-onboarding-recovery-block').classList.remove('hidden');
      }
    }).catch(() => {
      idEl.textContent = T('khatma_group.onboarding_id_offline', 'سيظهر عند اتصالك بالإنترنت');
    });
  }

  function kgFinishOnboarding() {
    markOnboarded();
    closeOverlay('#khatma-onboarding-overlay');
  }

  function wireOnboarding() {
    const doSaveOnboardingName = () => {
      const btn = $('#btn-kg-onboarding-name-save');
      if (btn.disabled) return;
      const name = $('#kg-onboarding-name-input').value.trim();
      if (!name) return;
      setMyName(name);
      kgGoOnboardingIdStep();
    };
    $('#btn-kg-onboarding-name-save').addEventListener('click', doSaveOnboardingName);
    $('#kg-onboarding-name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSaveOnboardingName(); });
    $('#btn-kg-onboarding-copy').addEventListener('click', async () => {
      const code = $('#kg-onboarding-id-text').textContent;
      if (!code || code.indexOf('•') !== -1) return; // لسه ما وصلش أو فشل الجلب
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(code);
        showToast(T('khatma_group.toast_id_copied', 'تم نسخ الـ ID'));
      } catch (e) { /* المتصفح رفض النسخ — العرض نفسه كفاية للمستخدم ينسخه يدويًا */ }
    });
    $('#btn-kg-onboarding-done').addEventListener('click', kgFinishOnboarding);
    $('#btn-kg-onboarding-recovery-copy').addEventListener('click', async () => {
      const code = $('#kg-onboarding-recovery-text').textContent;
      if (!code || code.indexOf('•') !== -1) return;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(code);
        showToast(T('khatma_group.toast_recovery_copied', 'تم نسخ كود الاسترجاع، احفظه في مكان آمن'));
      } catch (e) { /* تجاهل */ }
    });
    $('#btn-kg-onboarding-restore-open').addEventListener('click', () => openRestoreOverlay());
  }

  // -------- استرجاع الختمات الجماعية بكود قديم (مشترك بين شاشة الترحيب
  // وبين "بروفايلي") --------
  function openRestoreOverlay() {
    $('#kg-restore-code-input').value = '';
    $('#kg-restore-error').classList.add('hidden');
    openOverlay('#khatma-restore-overlay');
    setTimeout(() => { try { $('#kg-restore-code-input').focus(); } catch (e) { /* تجاهل */ } }, 200);
  }
  function wireRestoreOverlay() {
    $('#btn-kg-restore-cancel').addEventListener('click', () => closeOverlay('#khatma-restore-overlay'));
    initDragToClose('#khatma-restore-overlay .khatma-form-head', '#khatma-restore-overlay .overlay-sheet', () => closeOverlay('#khatma-restore-overlay'));
    $('#btn-kg-restore-submit').addEventListener('click', async () => {
      const btn = $('#btn-kg-restore-submit');
      if (btn.disabled) return;
      const raw = $('#kg-restore-code-input').value;
      const errEl = $('#kg-restore-error');
      errEl.classList.add('hidden');
      if (!raw.trim()) return;
      // تنبيه لو الحساب الحالي (الجديد) عنده أصلًا ختمات جماعية — الاسترجاع
      // بيستبدل الحساب بالكامل فهيفقد وصوله ليها (زي بالظبط تحذير استيراد
      // نسخة احتياطية في باقي التطبيق)
      const hadGroups = await currentAccountHasGroups();
      if (hadGroups && !confirm(T('khatma_group.confirm_restore_overwrite', 'توجد ختمات جماعية على الحساب الحالي. سيؤدي استعادة رمز قديم إلى استبدال الحساب وفقدان الوصول إلى ختماته، ما لم تحتفظ برمز استعادتها أيضًا. هل تريد المتابعة؟'))) return;
      btn.disabled = true;
      try {
        await restoreFromRecoveryCode(raw);
        closeOverlay('#khatma-restore-overlay');
        closeOverlay('#khatma-onboarding-overlay');
        closeOverlay('#khatma-profile-overlay');
        showToast(T('khatma_group.toast_restore_done', 'تم استرجاع ختماتك الجماعية بنجاح 🎉'), 2500);
        setTimeout(() => { try { location.reload(); } catch (e) { /* تجاهل */ } }, 900);
      } catch (e) {
        errEl.textContent = friendlyError(e);
        errEl.classList.remove('hidden');
      }
      btn.disabled = false;
    });
  }

  // بيدوّر على بروفايل شخص بالـ id الثابت بتاعه — يرجّع { uid, name } أو null
  async function findUserByCode(code) {
    await ensureReady();
    const clean = normalizeUserCode(code);
    if (!clean) return null;
    const rows = await FS.runQuery(USERS_COL, [{ field: 'code', op: 'EQUAL', value: clean }], 1);
    if (!rows.length) return null;
    return { uid: rows[0].id, name: (rows[0].data && rows[0].data.name) || '' };
  }

  // إضافة عضو مباشرة بالـ uid بتاعه (لمنشئ الختمة بس) — بديل لنظام طلب
  // الانضمام لما الأدمن عارف id الشخص مباشرة
  async function addMemberByCode(khatmaId, code) {
    await ensureReady();
    const found = await findUserByCode(code);
    if (!found) throw new Error('user-not-found');
    const res = await FS.runTransaction(COL, khatmaId, async (d) => {
      if (!d) throw new Error('not-found');
      if (d.creatorId !== myUid) throw new Error('not-admin');
      if ((d.memberUids || []).includes(found.uid)) return { result: 'already' };
      const members = d.members || {};
      members[found.uid] = { name: found.name || '', joinedAt: Date.now() };
      const memberUids = Array.from(new Set([...(d.memberUids || []), found.uid]));
      const pending = d.pending || {};
      delete pending[found.uid]; // لو كان عنده طلب انضمام معلّق، يتحسب اتقبل
      return { patch: { members, memberUids, pending, lastActivityAt: Date.now() }, result: 'added' };
    });
    return { status: res, name: found.name };
  }

  // مفيش اتصال "لحظي" (streaming) هنا عمدًا — دي بالظبط اللي كانت بتتعلق
  // جوه WebView الأندرويد. بدالها polling بسيط (قراءة عادية كل شوية ثواني)
  // بيدّي نفس الإحساس بالتحديث اللحظي من غير أي اتصال طويل مفتوح
  const POLL_MS = 4000;
  function subscribeGroup(id, cb) {
    let stopped = false;
    let inFlight = false;
    async function tick() {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const data = await FS.getDoc(COL, id);
        if (!stopped && data) cb(data);
      } catch (e) { /* تجاهل: هنعيد المحاولة تاني في التِك الجاي */ }
      inFlight = false;
    }
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }

  async function claimUnit(khatmaId, n) {
    await ensureReady();
    const name = getMyName();
    return FS.runTransaction(COL, khatmaId, async (d) => {
      if (!d) throw new Error('not-found');
      if (d.status !== 'active') throw new Error('expired');
      const units = d.units || {};
      const existing = units[n];
      const isStale = existing && !existing.done && (Date.now() - (existing.claimedAt || 0) > STALE_CLAIM_MS);
      if (existing && existing.uid !== myUid && !isStale) throw new Error('taken');
      units[n] = { uid: myUid, name, claimedAt: Date.now(), done: false, doneAt: null };
      return { patch: { units, lastActivityAt: Date.now() } };
    });
  }

  async function releaseUnit(khatmaId, n) {
    await ensureReady();
    return FS.runTransaction(COL, khatmaId, async (d) => {
      if (!d) throw new Error('not-found');
      const units = d.units || {};
      const existing = units[n];
      if (!existing || existing.uid !== myUid || existing.done) return null;
      delete units[n];
      return { patch: { units, lastActivityAt: Date.now() } };
    });
  }

  // بترجع true لو الإتمام ده خلّص الختمة كلها (١٠٠٪)، عشان نعرض شاشة الاحتفال.
  // للختمة المستمرة: بدل ما تتقفل نهائيًا، بتترجّع لدورة جديدة تلقائيًا (كل
  // الحجوزات بتتصفّر) وبيزيد عدّاد roundsCompleted بواحد، وتفضل status:'active'
  async function completeUnit(khatmaId, n) {
    await ensureReady();
    return FS.runTransaction(COL, khatmaId, async (d) => {
      if (!d) throw new Error('not-found');
      const units = d.units || {};
      const existing = units[n];
      if (!existing || existing.uid !== myUid) throw new Error('not-yours');
      if (existing.done) return { result: false };
      existing.done = true;
      existing.doneAt = Date.now();
      const completedCount = (d.completedCount || 0) + 1;
      const justCompleted = completedCount >= d.unitCount && d.status !== 'completed';
      if (justCompleted && d.continuous) {
        const patch = {
          units: {},
          completedCount: 0,
          roundsCompleted: (d.roundsCompleted || 0) + 1,
          lastRoundCompletedAt: Date.now(),
          status: 'active',
          lastActivityAt: Date.now()
        };
        return { patch, result: true };
      }
      const patch = { units, completedCount, lastActivityAt: Date.now() };
      if (justCompleted) { patch.status = 'completed'; patch.completedAt = Date.now(); }
      return { patch, result: justCompleted };
    });
  }

  async function leaveGroup(khatmaId) {
    await ensureReady();
    await FS.runTransaction(COL, khatmaId, async (d) => {
      if (!d) return null;
      const units = d.units || {};
      Object.keys(units).forEach((n) => { if (units[n].uid === myUid && !units[n].done) delete units[n]; });
      const memberUids = (d.memberUids || []).filter((u) => u !== myUid);
      const members = d.members || {};
      delete members[myUid];
      return { patch: { units, memberUids, members, lastActivityAt: Date.now() } };
    });
  }

  // تعديل بيانات الختمة الجماعية (المنشئ بس يقدر يعمل ده — شوف firestore.rules):
  // الاسم + تفعيل/إلغاء "ختمة مستمرة" + تاريخ الانتهاء، كلها في تحديث واحد.
  // لو الختمة اتحوّلت لمستمرة: تاريخ الانتهاء بيتشال (زي وقت الإنشاء بالظبط)
  async function updateGroupKhatmaSettings(khatmaId, { title, continuous, endDate }) {
    await ensureReady();
    const isContinuous = !!continuous;
    const patch = {
      title,
      continuous: isContinuous,
      endDate: isContinuous ? null : (endDate || null),
      status: 'active',
      lastActivityAt: Date.now()
    };
    await FS.updateDoc(COL, khatmaId, patch);
    return patch;
  }

  // توزيع تلقائي: بيقسّم كل الأجزاء/الصفحات بالتساوي على أعضاء الختمة الحاليين
  // (٣٠ جزء ÷ ٣ = ١٠ لكل واحد، ÷ ٥ = ٦ لكل واحد، وهكذا؛ والصفحات ٦٠٤ بنفس الطريقة).
  // كل ما يتداس تاني بيعيد التقسيم على العدد الحالي للأعضاء (لو زادوا أو قلّوا).
  // - الجزء/الصفحة اللي اتقرت (done) بيفضل مع صاحبه وبيتحسب من نصيبه، عشان
  //   التقدّم ما يضيعش ونصيب الباقي يتعدّل بالعدل.
  // - الباقي (المحجوز ولسه ما اتقراش، أو الفاضي) بيتقسّم قطع متتالية على الأعضاء
  //   بترتيبهم؛ ولو القسمة فيها باقي، أول الأعضاء ياخدوا واحد زيادة (٣٠÷٤ = ٨،٨،٧،٧).
  async function autoDistributeUnits(khatmaId) {
    await ensureReady();
    return FS.runTransaction(COL, khatmaId, async (d) => {
      if (!d) throw new Error('not-found');
      const memberUids = d.memberUids || [];
      if (!memberUids.length) return null;
      const members = d.members || {};
      const units = d.units || {};

      // ١) اللي اتقرا بيفضل لصاحبه ويتحسب من نصيبه؛ الباقي (open) هو اللي هيتقسّم
      const total = {};
      const need = {};
      memberUids.forEach((u) => { total[u] = 0; need[u] = 0; });
      const open = [];
      for (let n = 1; n <= d.unitCount; n++) {
        const u = units[n];
        if (u && u.done) { if (total[u.uid] !== undefined) total[u.uid]++; }
        else open.push(n);
      }

      // ٢) كل جزء متبقي بيروح لأقل عضو نصيبًا (تعادل: الأسبق في ترتيب الأعضاء)
      for (let k = 0; k < open.length; k++) {
        let best = memberUids[0];
        for (let m = 1; m < memberUids.length; m++) {
          if (total[memberUids[m]] < total[best]) best = memberUids[m];
        }
        total[best]++;
        need[best]++;
      }

      // ٣) توزيع قطع متتالية من الأجزاء المتبقية على الأعضاء بالترتيب
      let idx = 0;
      let changed = false;
      for (const uid of memberUids) {
        for (let c = 0; c < need[uid]; c++) {
          const n = open[idx++];
          const existing = units[n];
          if (existing && existing.uid === uid) continue; // نفس صاحبه — سيبه زي ما هو
          units[n] = { uid, name: (members[uid] && members[uid].name) || '', claimedAt: Date.now(), done: false, doneAt: null, byAdmin: true };
          changed = true;
        }
      }
      if (!changed) return null;
      return { patch: { units, lastActivityAt: Date.now() } };
    });
  }

  // توزيع يدوي: المنشئ بيدوس على عضو من القايمة وبعدين على الأجزاء اللي
  // عايز يدّيهاله — بتحجزله حتى لو كانت محجوزة لحد تاني (صلاحية إدارية)،
  // وبتفك الحجز لو دس على جزء هو أصلًا صاحبه (تبديل)
  async function adminAssignUnit(khatmaId, n, member) {
    await ensureReady();
    return FS.runTransaction(COL, khatmaId, async (d) => {
      if (!d) throw new Error('not-found');
      const units = d.units || {};
      const existing = units[n];
      if (existing && existing.uid === member.uid && !existing.done) {
        delete units[n];
      } else {
        units[n] = { uid: member.uid, name: member.name || '', claimedAt: Date.now(), done: false, doneAt: null, byAdmin: true };
      }
      return { patch: { units, lastActivityAt: Date.now() } };
    });
  }

  // تغيير اسم العضو لنفسه: بيتحدّث في قايمة الأعضاء وكمان في أي جزء/صفحة
  // محجوزة أو مقروءة باسمه (لأن الاسم متخزّن جوّه كل جزء)، فالاسم الجديد
  // يظهر عند الكل مكان القديم
  async function renameMyself(khatmaId, newName) {
    await ensureReady();
    await FS.runTransaction(COL, khatmaId, async (d) => {
      if (!d) throw new Error('not-found');
      if (!(d.memberUids || []).includes(myUid)) return null;
      const members = d.members || {};
      members[myUid] = { ...(members[myUid] || { joinedAt: Date.now() }), name: newName };
      const units = d.units || {};
      Object.keys(units).forEach((n) => { if (units[n] && units[n].uid === myUid) units[n].name = newName; });
      return { patch: { members, units } };
    });
  }

  // الاسم واحد لكل ختماتي: بعد ما يتغيّر في الختمة المفتوحة، نمرّ بهدوء على
  // باقي ختماتي الجماعية ونحدّثه فيها (لو فشلت أي واحدة بنكمّل، مش مشكلة)
  async function syncNameToOtherGroups(newName, exceptId) {
    try {
      const groups = await listMyGroups();
      for (const g of groups) {
        if (g.id === exceptId) continue;
        const cur = g.members && g.members[myUid] && g.members[myUid].name;
        if (cur === newName) continue;
        try { await renameMyself(g.id, newName); } catch (e) { /* تجاهل */ }
      }
    } catch (e) { /* تجاهل */ }
  }

  // إزالة عضو من الختمة — للمنشئ (الأدمن) بس. الأجزاء اللي حجزها العضو ولسه
  // ما قراهاش بترجع متاحة، والأجزاء اللي خلّصها بتفضل محسوبة في تقدّم الختمة
  // (باسمه) زي ما بيحصل بالظبط لما عضو يغادر بنفسه
  async function removeMember(khatmaId, uid) {
    await ensureReady();
    await FS.runTransaction(COL, khatmaId, async (d) => {
      if (!d) throw new Error('not-found');
      if (d.creatorId !== myUid) throw new Error('not-admin');
      if (uid === d.creatorId) throw new Error('not-admin');
      const units = d.units || {};
      Object.keys(units).forEach((n) => { if (units[n] && units[n].uid === uid && !units[n].done) delete units[n]; });
      const memberUids = (d.memberUids || []).filter((u) => u !== uid);
      const members = d.members || {};
      delete members[uid];
      return { patch: { units, memberUids, members, lastActivityAt: Date.now() } };
    });
  }

  async function deleteGroup(khatmaId) {
    await ensureReady();
    await FS.deleteDoc(COL, khatmaId);
  }

  // فحص انتهاء الموعد: بيتنفّذ محليًا كل ما تُفتح الختمة، وأول عضو يفتحها
  // بعد الموعد هو اللي بيحوّل حالتها لـ "منتهية" (مفيش سيرفر يعمل ده تلقائيًا)
  async function checkExpiryLocally(khatmaId, data) {
    if (data.status !== 'active' || !data.endDate) return data;
    const end = new Date(data.endDate + 'T23:59:59').getTime();
    if (Date.now() <= end) return data;
    try { await FS.updateDoc(COL, khatmaId, { status: 'expired' }); } catch (e) { /* تجاهل */ }
    return { ...data, status: 'expired' };
  }

  /* ================================================================== */
  /* 4) تذكيرات محلية (LocalNotifications): بتتجدول وقت النظام فعليًا،   */
  /*    فبتشتغل حتى لو التطبيق مقفول تمامًا — مش محتاجة السيرفر يكون شغال */
  /* ================================================================== */
  const KG_DAILY_ID = 9400; // معرّف التذكير اليومي القديم لإلغائه بعد التحديث
  const KG_DAILY_ID_BASE = 9500;
  const KG_DAILY_SLOT_COUNT = 1000;
  const KG_END_ID_BASE = 9401; // 9401..9420 — عشرين ختمة جماعية بحد أقصى لكل جهاز
  const KG_END_SLOTS = 20;
  const KG_DAILY_PREFS_KEY = 'almus-hraf:kgDailyReminderPrefs:';
  const KG_DAILY_SLOTS_KEY = 'almus-hraf:kgDailyReminderSlots:';

  function readDailyReminderPrefs() {
    try { return JSON.parse(localStorage.getItem(KG_DAILY_PREFS_KEY + myUid) || '{}') || {}; }
    catch (e) { return {}; }
  }

  function writeDailyReminderPrefs(prefs) {
    try { localStorage.setItem(KG_DAILY_PREFS_KEY + myUid, JSON.stringify(prefs || {})); }
    catch (e) { /* تجاهل: إعداد الجهاز يظل اختياريًا */ }
  }

  function readDailyReminderSlots() {
    try { return JSON.parse(localStorage.getItem(KG_DAILY_SLOTS_KEY + myUid) || '{}') || {}; }
    catch (e) { return {}; }
  }

  function dailyReminderSlotsFor(groupIds) {
    const slots = readDailyReminderSlots();
    const occupied = new Set();
    Object.keys(slots).forEach((id) => {
      const slot = Number(slots[id]);
      if (Number.isInteger(slot) && slot >= 0 && slot < KG_DAILY_SLOT_COUNT) occupied.add(slot);
      else delete slots[id];
    });
    groupIds.forEach((groupId) => {
      const existing = Number(slots[groupId]);
      if (Number.isInteger(existing) && existing >= 0 && existing < KG_DAILY_SLOT_COUNT) return;
      let slot = hashToSlot(groupId, KG_DAILY_SLOT_COUNT);
      for (let tries = 0; tries < KG_DAILY_SLOT_COUNT && occupied.has(slot); tries++) slot = (slot + 1) % KG_DAILY_SLOT_COUNT;
      if (!occupied.has(slot)) {
        slots[groupId] = slot;
        occupied.add(slot);
      }
    });
    try { localStorage.setItem(KG_DAILY_SLOTS_KEY + myUid, JSON.stringify(slots)); } catch (e) { /* تجاهل */ }
    return slots;
  }

  function hashToSlot(id, slots) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return h % slots;
  }

  async function scheduleReminders(myGroups) {
    const ln = getLocalNotifPlugin();
    if (!ln) return false; // متصفح/PWA عادي بلا Capacitor: مفيش جدولة نظام هنا

    const prefs = readDailyReminderPrefs();
    const configuredGroups = (myGroups || []).filter((k) => prefs[k.id] && /^([01]\d|2[0-3]):[0-5]\d$/.test(prefs[k.id]));
    const slots = dailyReminderSlotsFor(configuredGroups.map((k) => k.id));
    // ألغِ التذكير القديم الثابت وكل المواعيد السابقة قبل إعادة جدولة
    // تذكير مستقل لكل ختمة اختار المستخدم لها موعدًا.
    const dailyCancelIds = [{ id: KG_DAILY_ID }];
    Object.values(slots).forEach((slot) => dailyCancelIds.push({ id: KG_DAILY_ID_BASE + Number(slot) }));
    try { await ln.cancel({ notifications: dailyCancelIds }); } catch (e) { /* تجاهل */ }

    // الموعد اختياري لكل عضو في الختمة؛ ما نربطش الإشعار بوجود جزء مسند
    // له حاليًا، لأن العضو قد يريد تذكيرًا يوميًا حتى قبل استلام الجزء.
    const dailyNotifications = configuredGroups.filter((k) => k.status === 'active');
    let dailyScheduleSucceeded = false;
    if (dailyNotifications.length) {
      const notifications = dailyNotifications.map((k) => {
        const [hour, minute] = prefs[k.id].split(':').map(Number);
        return {
          id: KG_DAILY_ID_BASE + Number(slots[k.id]),
          title: T('khatma_group.notif_daily_title', 'موعد وردك اليومي'),
          body: T('khatma_group.notif_daily_group', 'حان موعد قراءة وردك في ختمة «{name}»').replace('{name}', k.title),
          channelId: 'mushaf-khatma-group',
          sound: 'dong.mp3',
          schedule: { on: { hour, minute }, allowWhileIdle: true },
          isExactNotification: false,
          extra: { kind: 'khatma-group-daily', khatmaId: k.id }
        };
      });
      try {
        await ln.schedule({ notifications });
        dailyScheduleSucceeded = true;
      } catch (e) {
        console.warn('[khatma-group] تعذرت جدولة تذكير الورد اليومي:', e);
      }
    }

    // تذكير قبل ٢٤ ساعة من انتهاء كل ختمة نشِطة ليها موعد
    const cancelIds = [];
    for (let i = 0; i < KG_END_SLOTS; i++) cancelIds.push({ id: KG_END_ID_BASE + i });
    try { await ln.cancel({ notifications: cancelIds }); } catch (e) { /* تجاهل */ }
    const withEnd = myGroups.filter((k) => k.status === 'active' && k.endDate);
    const notifications = [];
    withEnd.forEach((k) => {
      const end = new Date(k.endDate + 'T23:59:59').getTime();
      const at = end - 24 * 60 * 60 * 1000;
      if (at <= Date.now()) return;
      const units = k.units || {};
      const mineLeft = Object.values(units).filter((u) => u.uid === myUid && !u.done).length;
      const total = k.unitCount - (k.completedCount || 0);
      notifications.push({
        id: KG_END_ID_BASE + hashToSlot(k.id, KG_END_SLOTS),
        title: T('khatma_group.notif_end_title', 'باقي يوم واحد على "{name}"').replace('{name}', k.title),
        body: total > 0
          ? T('khatma_group.notif_end_body', 'تبقّى {n} أجزاء لم تُقرأ' + (mineLeft ? ' ({mine} منهم عليك)' : '')).replace('{n}', toArabicDigits(total)).replace('{mine}', toArabicDigits(mineLeft))
          : T('khatma_group.notif_end_body_done', 'أوشكت الختمة على الاكتمال. بالتوفيق لبقية المشاركين.'),
        channelId: 'mushaf-khatma-group',
        sound: 'dong.mp3',
        schedule: { at: new Date(at), allowWhileIdle: true },
        isExactNotification: false,
        extra: { kind: 'khatma-group-end' }
      });
    });
    if (notifications.length) { try { await ln.schedule({ notifications }); } catch (e) { /* تذكير انتهاء الختمة اختياري */ } }
    return dailyScheduleSucceeded;
  }

  function fireLocalPush(title, body) {
    const ln = getLocalNotifPlugin();
    if (!ln) return;
    ln.schedule({
      notifications: [{
        id: Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000),
        title,
        body,
        channelId: 'mushaf-khatma-group',
        sound: 'dong.mp3',
        isExactNotification: false
      }]
    }).catch(() => { /* تجاهل */ });
  }

  function fireCompletionNotification(title) {
    fireLocalPush(T('khatma_group.celebrate_title', '🎉 تمّت الختمة الجماعية بالكامل'), title);
  }

  // بيقارن نسخة قديمة من ختماتي بنسخة جديدة، وبيرجّع أحداث "عضو جديد انضم"
  // و"حد خلّص جزءه/صفحته" (من غير حالة الاكتمال الكامل، ليها منطقها الخاص
  // فوق). بيتجاهل أي ختمة جديدة عليّ تمامًا (لسه مش موجودة في النسخة القديمة)
  // عشان ما يبلّغنيش بحاجات أنا سببها بنفسي (زي انضمامي الأول لختمة)
  function collectGroupEvents(prevList, newList) {
    const events = [];
    const prevMap = {};
    (prevList || []).forEach((k) => { if (k && k.id) prevMap[k.id] = k; });
    (newList || []).forEach((k) => {
      if (!k || !k.id) return;
      const prev = prevMap[k.id];
      if (!prev) return;
      const prevMembers = new Set(prev.memberUids || []);
      (k.memberUids || []).forEach((uid) => {
        if (uid === myUid || prevMembers.has(uid)) return;
        const name = (k.members && k.members[uid] && k.members[uid].name) || '';
        events.push({ type: 'joined', khatmaTitle: k.title, name });
      });
      const prevUnits = prev.units || {};
      const newUnits = k.units || {};
      Object.keys(newUnits).forEach((n) => {
        const nu = newUnits[n];
        const pu = prevUnits[n];
        if (nu && nu.done && nu.uid !== myUid && (!pu || !pu.done)) {
          events.push({ type: 'unit-done', khatmaTitle: k.title, name: nu.name, unitText: unitLabel(k.unitType, Number(n)) });
        }
      });
    });
    return events;
  }

  // إشعارات نظام (لما التطبيق يكون مقفول/في الخلفية) — بتتنده من refreshHub
  function notifyGroupEventsAsPush(events) {
    events.forEach((ev) => {
      if (ev.type === 'joined') {
        fireLocalPush(
          T('khatma_group.notif_joined_title', 'عضو جديد 🤍'),
          T('khatma_group.notif_joined_body', '{name} انضم إلى "{title}"')
            .replace('{name}', ev.name || T('khatma_group.member_fallback_join', 'عضو جديد'))
            .replace('{title}', ev.khatmaTitle)
        );
      } else if (ev.type === 'unit-done') {
        fireLocalPush(
          T('khatma_group.notif_unit_done_title', 'إنجاز جديد 🤍'),
          T('khatma_group.notif_unit_done_body', '{name} خلّص قراءة {unit} في "{title}"')
            .replace('{name}', ev.name || T('khatma_group.member_fallback_generic', 'أحد الأعضاء'))
            .replace('{unit}', ev.unitText)
            .replace('{title}', ev.khatmaTitle)
        );
      }
    });
  }

  // Toast فوري جوّه شاشة تفاصيل الختمة نفسها (المستخدم شايف الشاشة أصلاً،
  // فمفيش داعي لإشعار نظام كامل) — بيعرض أول حدث بس عشان ما يغرقش الشاشة
  function notifyGroupEventsAsToast(events) {
    if (!events.length) return;
    const ev = events[0];
    if (ev.type === 'joined') {
      showToast(T('khatma_group.toast_member_joined', '{name} انضمّ إلى الختمة').replace('{name}', ev.name || T('khatma_group.member_fallback_join', 'عضو جديد')));
    } else if (ev.type === 'unit-done') {
      showToast(T('khatma_group.toast_unit_done', '{name} أنهى قراءة {unit}').replace('{name}', ev.name || T('khatma_group.member_fallback_generic', 'أحد الأعضاء')).replace('{unit}', ev.unitText));
    }
  }

  /* ================================================================== */
  /* 4.5) Push من السيرفر (FCM) — بيوصّل الإشعارات والتطبيق مقفول        */
  /*      السيرفر = الراسبيري باي (مجلد pi-push-server)                    */
  /* ================================================================== */
  const PUSH_TOKENS_COL = 'pushTokens';
  const SERVER_PUSH_FLAG = 'almus-hraf:kgServerPush';
  let pushSetupTried = false;
  let pushListenersAdded = false;

  function isServerPushActive() {
    try { return localStorage.getItem(SERVER_PUSH_FLAG) === '1'; } catch (e) { return false; }
  }
  function getPushPlugin() {
    try { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications) || null; }
    catch (e) { return null; }
  }

  async function savePushToken(token) {
    try {
      await ensureReady();
      // doc واحد لكل مستخدم (id = uid) — لو FirestoreLite فيه setDoc بنستخدمه، وإلا updateDoc (PATCH بيعمل upsert)
      const write = FS.setDoc || FS.updateDoc;
      await write.call(FS, PUSH_TOKENS_COL, myUid, { token, platform: 'android', updatedAt: Date.now() });
      try { localStorage.setItem(SERVER_PUSH_FLAG, '1'); } catch (e) { /* تجاهل */ }
    } catch (e) {
      try { localStorage.removeItem(SERVER_PUSH_FLAG); } catch (e2) { /* تجاهل */ }
      console.warn('kg push: تعذّر حفظ التوكن', e);
    }
  }

  async function setupServerPush() {
    if (pushSetupTried) return;
    const P = getPushPlugin();
    if (!P) return; // متصفح عادي أو الـ plugin مش متركّب
    pushSetupTried = true;
    try {
      let perm = await P.checkPermissions();
      if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') perm = await P.requestPermissions();
      if (perm.receive !== 'granted') return;

      if (!pushListenersAdded) {
        pushListenersAdded = true;
        P.addListener('registration', (t) => { if (t && t.value) savePushToken(t.value); });
        P.addListener('registrationError', (e) => console.warn('kg push: registrationError', e));
        // التطبيق مفتوح وجاله إشعار: نحدّث القايمة بهدوء
        P.addListener('pushNotificationReceived', () => { if (navigator.onLine) refreshHub().catch(() => {}); });
        // المستخدم داس على الإشعار: نفتح الختمة نفسها
        P.addListener('pushNotificationActionPerformed', (a) => {
          const id = a && a.notification && a.notification.data && a.notification.data.khatmaId;
          if (id) setTimeout(() => { try { openDetails(id); } catch (e) { /* تجاهل */ } }, 400);
        });
      }
      // نفس معرّف القناة (mushaf-khatma-group) ونفس الصوت (dong.mp3) المُنشأين
      // في LocalNotifications (راجع initNotificationChannel في app.js)، عشان
      // إشعارات الختمة الجماعية تطلع بنفس النغمة سواء جت من جدولة محلية أو من
      // بلاغ سيرفر (FCM). القناة القديمة 'khatma_group' كانت من غير أي "sound"
      // محدّد، فكان أندرويد بيستخدم نغمة النظام الافتراضية (زي رسالة SMS) —
      // وده بالظبط سبب "الصوت بتاعها بيجي زي إشعار SMS مش notify.mp3/dong.mp3"
      if (P.createChannel) {
        try {
          await P.createChannel({
            id: 'mushaf-khatma-group',
            name: 'الختمة الجماعية',
            description: 'إشعارات الختمة الجماعية (أعضاء، إنجاز، تذكيرات)',
            importance: 5,
            visibility: 1,
            sound: 'dong.mp3',
            vibration: true
          });
        } catch (e) { /* تجاهل */ }
      }
      await P.register(); // بيرجّع التوكن في حدث 'registration'
    } catch (e) {
      console.warn('kg push: setup failed', e);
    }
  }

  /* ================================================================== */
  /* 5) الحالة والرسم (UI)                                                */
  /* ================================================================== */
  let myGroupsCache = [];

  // بيرجّع أقل رقم وحدة (صفحة/جزء) متكلة عليّ ولسه مش متسجّلة "تمّت" في ختمة
  // جماعية بعينها، غير الوحدة excludeUnit (اللي غالبًا لسه بس هيتسجّل تمامها)
  // — بيعتمد على myGroupsCache المحلي، من غير أي طلب شبكة إضافي
  function findMyNextUnit(khatmaId, excludeUnit) {
    const k = myGroupsCache.find((g) => g.id === khatmaId);
    if (!k || !k.units) return null;
    let best = null;
    Object.keys(k.units).forEach((n) => {
      const u = k.units[n];
      const num = Number(n);
      if (u && u.uid === myUid && !u.done && num !== excludeUnit) {
        if (best === null || num < best) best = num;
      }
    });
    return best;
  }
  let currentDetailsId = null;
  let unsubDetails = null;
  let currentDetailsData = null;
  let selectedUnit = null;
  let unitFilter = 'all';
  let unitSearchQuery = '';
  let unitPageWindow = 0;
  const UNIT_PAGE_WINDOW_SIZE = 60;
  let leavingGroupId = null; // بيمنع كشف "اتشلت من الختمة" أثناء مغادرتي أنا بنفسي
  const celebratedIds = new Set(JSON.parse(localStorage.getItem('almus-hraf:kgCelebrated') || '[]'));
  function markCelebrated(id) {
    celebratedIds.add(id);
    try { localStorage.setItem('almus-hraf:kgCelebrated', JSON.stringify(Array.from(celebratedIds))); } catch (e) { /* تجاهل */ }
  }
  // للختمة المستمرة: بنتتبّع آخر رقم دورة شافه الجهاز ده لكل ختمة، عشان
  // نطلّع إشعار إتمام كل دورة (مش مرة واحدة بس زي الختمة العادية)
  const KG_ROUNDS_SEEN_KEY = 'almus-hraf:kgRoundsSeen';
  function readRoundsSeen() {
    try { const o = JSON.parse(localStorage.getItem(KG_ROUNDS_SEEN_KEY) || '{}'); return o && typeof o === 'object' ? o : {}; }
    catch (e) { return {}; }
  }
  function markRoundSeen(id, round) {
    const seen = readRoundsSeen();
    seen[id] = round;
    try { localStorage.setItem(KG_ROUNDS_SEEN_KEY, JSON.stringify(seen)); } catch (e) { /* تجاهل */ }
  }

  function renderMyGroupsList() {
    const list = $('#kg-my-list');
    const empty = $('#kg-my-list-empty');
    if (!list) return;
    if (!myGroupsCache.length) {
      if (empty) empty.classList.remove('hidden');
      $$('.kg-row', list).forEach((n) => n.remove());
      return;
    }
    if (empty) empty.classList.add('hidden');
    list.innerHTML = `<p class="khatma-history-empty hidden" id="kg-my-list-empty"></p>` + myGroupsCache.map((k) => {
      const pct = Math.round(((k.completedCount || 0) / k.unitCount) * 100);
      const statusBadge = k.status === 'completed' ? `<span class="kg-row-badge">${escapeHTML(T('khatma_group.status_completed', 'مكتملة'))}</span>`
        : k.status === 'expired' ? `<span class="kg-row-badge">${escapeHTML(T('khatma_group.status_expired', 'منتهية'))}</span>`
        : k.continuous ? `<span class="kg-row-badge">${escapeHTML(T('khatma_group.continuous_badge', 'مستمرة'))}</span>` : '';
      const roundsHint = k.continuous && k.roundsCompleted
        ? ` · ${escapeHTML(T('khatma_group.rounds_completed', 'اكتملت {n} مرة').replace('{n}', toArabicDigits(k.roundsCompleted)))}`
        : '';
      return `
        <div class="khatma-preset-row kg-row" data-kg-open="${k.id}">
          <span class="khatma-preset-radio"><svg><use href="#${k.type === 'public' ? 'icon-users' : 'icon-link'}"></use></svg></span>
          <span class="khatma-preset-text">
            <strong>${escapeHTML(k.title)}${statusBadge}</strong>
            <small>${escapeHTML((k.memberUids || []).length + ' ')}${escapeHTML(T('khatma_group.members_word', 'عضو'))}${roundsHint}</small>
          </span>
          <span class="kg-row-progress">${toArabicDigits(pct)}٪</span>
        </div>`;
    }).join('');
  }

  function renderPublicGroupsList(groups) {
    const list = $('#kg-public-list');
    if (!list) return;
    if (!groups.length) {
      list.innerHTML = `<p class="khatma-history-empty">${escapeHTML(T('khatma_group.no_public', 'لا توجد ختمات عامة متاحة حاليًا'))}</p>`;
      return;
    }
    list.innerHTML = groups.map((k) => {
      const pct = Math.round(((k.completedCount || 0) / k.unitCount) * 100);
      return `
        <div class="khatma-preset-row kg-row" data-kg-join-id="${k.id}" data-kg-join-code="${k.inviteCode}">
          <span class="khatma-preset-radio"><svg><use href="#icon-users"></use></svg></span>
          <span class="khatma-preset-text">
            <strong>${escapeHTML(k.title)}</strong>
            <small>${escapeHTML((k.memberUids || []).length + ' ')}${escapeHTML(T('khatma_group.members_word', 'عضو'))}</small>
          </span>
          <span class="kg-row-progress">${toArabicDigits(pct)}٪</span>
        </div>`;
    }).join('');
  }

  // آخر قائمة ختمات جماعية معروفة، محفوظة محليًا عشان صفحة "الختمة" الرئيسية
  // (app.js) تقدر تعرضها فورًا عند فتح التطبيق من غير ما تستنى استجابة الشبكة
  const KG_HOME_CACHE_KEY = 'almus-hraf:kgLastKnown';
  function readCachedGroups() {
    try { const arr = JSON.parse(localStorage.getItem(KG_HOME_CACHE_KEY) || '[]'); return Array.isArray(arr) ? arr : []; }
    catch (e) { return []; }
  }

  async function refreshHub() {
    const note = $('#kg-offline-note');
    const previousGroups = readCachedGroups();
    try {
      myGroupsCache = await listMyGroups();
      if (note) note.classList.add('hidden');
      try { localStorage.setItem(KG_HOME_CACHE_KEY, JSON.stringify(myGroupsCache)); } catch (e) { /* تجاهل */ }
      // لو الـ push بتاع السيرفر شغّال، هو اللي بيبعت إشعارات الأحداث (عشان ما يتكرّرش الإشعار)
      if (!isServerPushActive()) notifyGroupEventsAsPush(collectGroupEvents(previousGroups, myGroupsCache));
      if (myGroupsCache.length) setupServerPush();
    } catch (e) {
      if (note) note.classList.remove('hidden');
      // لو حصل خطأ (غالبًا مفيش إنترنت)، نستخدم آخر قائمة معروفة بدل ما
      // نمسحها، عشان قسمة صفحة "الختمة" الرئيسية ما تختفيش بسبب انقطاع مؤقت
      myGroupsCache = readCachedGroups();
    }
    renderMyGroupsList();
    // بنبلّغ app.js بأي تغيير في ختماتي الجماعية عشان يحدّث قسمة صفحة "الختمة"
    // الرئيسية (فردية/جماعية) — شوف app.js: خاتمة defaultKhatmaState
    try { window.dispatchEvent(new CustomEvent('kg:my-groups-updated', { detail: { groups: myGroupsCache } })); } catch (e) { /* تجاهل */ }
    scheduleReminders(myGroupsCache);
    // إشعار محلي فوري لو ختمة اكتملت من غير ما أشوفها في شاشة التفاصيل
    myGroupsCache.forEach((k) => {
      if (k.status === 'completed' && !celebratedIds.has(k.id)) {
        markCelebrated(k.id);
        if (!isServerPushActive()) fireCompletionNotification(k.title);
      } else if (k.continuous && k.roundsCompleted) {
        const seen = readRoundsSeen();
        if ((seen[k.id] || 0) < k.roundsCompleted) {
          markRoundSeen(k.id, k.roundsCompleted);
          if (!isServerPushActive()) fireCompletionNotification(k.title);
        }
      }
    });
  }

  function unitStatusFor(data, n) {
    const u = (data.units || {})[n];
    if (!u) return { state: 'free' };
    if (u.uid === myUid) return { state: u.done ? 'mine-done' : 'mine', unit: u };
    return { state: u.done ? 'others-done' : 'others', unit: u };
  }

  function renderUnitsGrid() {
    const grid = $('#kg-units-grid');
    const gridTitle = $('#kg-grid-title');
    if (!grid || !currentDetailsData) return;
    const d = currentDetailsData;
    grid.classList.toggle('is-pages', d.unitType === 'page');
    if (gridTitle) gridTitle.textContent = T(d.unitType === 'page' ? 'khatma_group.units_page_title' : 'khatma_group.units_juz_title', d.unitType === 'page' ? 'الصفحات' : 'الأجزاء');
    const unitSearch = $('#kg-unit-search');
    if (unitSearch) {
      const label = d.unitType === 'page' ? 'ابحث برقم الصفحة' : 'ابحث برقم الجزء';
      unitSearch.placeholder = label;
      unitSearch.setAttribute('aria-label', label);
    }

    const query = unitSearchQuery.trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
    const units = [];
    for (let n = 1; n <= d.unitCount; n++) {
      const st = unitStatusFor(d, n);
      const done = st.state.endsWith('done');
      const keep = unitFilter === 'all' || (unitFilter === 'free' && st.state === 'free') || (unitFilter === 'mine' && st.state.startsWith('mine')) || (unitFilter === 'others' && st.state.startsWith('others')) || (unitFilter === 'done' && done);
      if (!keep || (query && !String(n).includes(query))) continue;
      const cls = st.state === 'free' ? '' : st.state === 'mine' ? 'is-mine' : st.state === 'mine-done' ? 'is-mine is-done' : st.state === 'others-done' ? 'is-others is-done' : 'is-others';
      const sel = selectedUnit === n ? ' is-selected' : '';
      const check = st.state.endsWith('done') ? '<span class="kg-unit-check"><svg><use href="#icon-check-circle"></use></svg></span>' : '';
      units.push(`<button type="button" class="kg-unit-cell ${cls}${sel}" data-unit="${n}" title="${escapeHTML(unitLabel(d.unitType, n))}">${check}${toArabicDigits(n)}</button>`);
    }
    const pageMode = d.unitType === 'page';
    const pageCount = pageMode ? Math.max(1, Math.ceil(units.length / UNIT_PAGE_WINDOW_SIZE)) : 1;
    unitPageWindow = Math.min(unitPageWindow, pageCount - 1);
    const start = pageMode ? unitPageWindow * UNIT_PAGE_WINDOW_SIZE : 0;
    grid.innerHTML = units.slice(start, pageMode ? start + UNIT_PAGE_WINDOW_SIZE : undefined).join('') || `<p class="kg-unit-no-results">${escapeHTML(T('khatma_group.no_units_match', 'لا توجد نتائج مطابقة'))}</p>`;
    const pager = $('#kg-unit-pagination');
    if (pager) {
      pager.classList.toggle('hidden', !pageMode || units.length <= UNIT_PAGE_WINDOW_SIZE);
      const label = $('#kg-unit-page-label');
      if (label) label.textContent = T('khatma_group.units_page_range', 'عرض {from}–{to} من {total}').replace('{from}', toArabicDigits(units.length ? start + 1 : 0)).replace('{to}', toArabicDigits(Math.min(start + UNIT_PAGE_WINDOW_SIZE, units.length))).replace('{total}', toArabicDigits(units.length));
      const prev = $('#kg-unit-page-prev'); const next = $('#kg-unit-page-next');
      if (prev) prev.disabled = unitPageWindow <= 0;
      if (next) next.disabled = unitPageWindow >= pageCount - 1;
    }
    const clear = $('#kg-unit-search-clear');
    if (clear) clear.classList.toggle('hidden', !unitSearchQuery);
  }

  function renderSelectedCard() {
    const card = $('#kg-selected-card');
    const titleEl = $('#kg-selected-title');
    const statusEl = $('#kg-selected-status');
    const actionsEl = $('#kg-selected-actions');
    if (!card || !currentDetailsData) return;
    if (selectedUnit == null) { card.classList.add('hidden'); return; }
    card.classList.remove('hidden');
    const d = currentDetailsData;
    const st = unitStatusFor(d, selectedUnit);
    titleEl.textContent = unitLabel(d.unitType, selectedUnit);

    const canAct = d.status === 'active';
    let statusText = '';
    let actionsHtml = '';
    if (st.state === 'free') {
      statusText = T('khatma_group.status_free', 'متاح — محدش حجزه');
    } else if (st.state === 'mine') {
      statusText = T('khatma_group.status_mine', 'محجوز لك');
      if (canAct) {
        actionsHtml = `
          <button type="button" class="khatma-primary-btn" id="btn-kg-read"><svg><use href="#icon-book"></use></svg><span>${escapeHTML(T('khatma_group.read_btn', 'اقرأ الجزء'))}</span></button>
          <button type="button" class="kg-btn-secondary" id="btn-kg-done">${escapeHTML(T('khatma_group.done_btn', 'تمت القراءة'))}</button>
          <button type="button" class="kg-btn-text" id="btn-kg-release">${escapeHTML(T('khatma_group.release_btn', 'تحرير الحجز'))}</button>`;
      }
    } else if (st.state === 'mine-done') {
      statusText = T('khatma_group.status_mine_done', 'تمّت قراءته منك الساعة {t}').replace('{t}', fmtTime(st.unit.doneAt));
      actionsHtml = `<button type="button" class="khatma-primary-btn" id="btn-kg-read"><svg><use href="#icon-book"></use></svg><span>${escapeHTML(T('khatma_group.reread_btn', 'أعد القراءة'))}</span></button>`;
    } else if (st.state === 'others') {
      statusText = T('khatma_group.status_others', 'محجوز لـ {name}').replace('{name}', escapeHTML(st.unit.name || '—'));
      actionsHtml = `<button type="button" class="kg-btn-secondary" id="btn-kg-read"><svg><use href="#icon-book"></use></svg><span>${escapeHTML(T('khatma_group.read_along_btn', 'اقرأ معاه'))}</span></button>`;
    } else if (st.state === 'others-done') {
      statusText = T('khatma_group.status_others_done', 'قرأه {name} الساعة {t}').replace('{name}', escapeHTML(st.unit.name || '—')).replace('{t}', fmtTime(st.unit.doneAt));
      actionsHtml = `<button type="button" class="kg-btn-secondary" id="btn-kg-read"><svg><use href="#icon-book"></use></svg><span>${escapeHTML(T('khatma_group.read_along_btn', 'اقرأ معاه'))}</span></button>`;
    }
    statusEl.textContent = statusText;
    actionsEl.innerHTML = actionsHtml;

    const btnRead = $('#btn-kg-read');
    if (btnRead) btnRead.addEventListener('click', () => {
      startReadingSession(currentDetailsId, d.title, d.unitType, selectedUnit);
    });
    const btnDone = $('#btn-kg-done');
    if (btnDone) btnDone.addEventListener('click', async () => {
      btnDone.disabled = true;
      try {
        const justCompleted = await completeUnit(currentDetailsId, selectedUnit);
        showToast(T('khatma_group.toast_done', 'تمّت القراءة، تقبّل الله'));
        if (justCompleted) {
          if (d.continuous) { const newRound = (d.roundsCompleted || 0) + 1; markRoundSeen(currentDetailsId, newRound); openCelebration(d.title, { continuous: true, round: newRound }); }
          else { markCelebrated(currentDetailsId); openCelebration(d.title); }
        }
      } catch (e) { showToast(friendlyError(e), 4000); }
      btnDone.disabled = false;
    });
    const btnRelease = $('#btn-kg-release');
    if (btnRelease) btnRelease.addEventListener('click', async () => {
      try { await releaseUnit(currentDetailsId, selectedUnit); selectedUnit = null; showToast(T('khatma_group.toast_released', 'تم إلغاء الحجز')); }
      catch (e) { showToast(friendlyError(e)); }
    });
  }

  function renderDetailsHeader() {
    if (!currentDetailsData) return;
    const d = currentDetailsData;
    const pct = Math.round(((d.completedCount || 0) / d.unitCount) * 100);
    const ring = $('#kg-details-ring');
    const ringPct = $('#kg-details-ring-pct');
    const titleEl = $('#kg-details-title');
    const progressText = $('#kg-details-progress-text');
    const meta = $('#kg-details-meta');
    const banner = $('#kg-status-banner');
    const deleteBtn = $('#btn-kg-delete');
    if (ring) ring.style.setProperty('--progress', pct);
    if (ringPct) ringPct.textContent = `${toArabicDigits(pct)}٪`;
    if (titleEl) titleEl.textContent = d.title;
    const reminderTime = $('#kg-daily-reminder-time');
    if (reminderTime && document.activeElement !== reminderTime) reminderTime.value = readDailyReminderPrefs()[d.id] || '';
    // الملخص المطوي يعرض الموعد المحفوظ، لا قيمة حقل الإدخال المؤقتة؛
    // أندرويد قد يفرّغ الحقل بعد إغلاق منتقي الوقت رغم حفظ التفضيل بنجاح.
    syncDailyReminderPicker();
    if (progressText) progressText.textContent = T('khatma_group.progress_text', '{done} من {total} {unit} تم قراءتهم')
      .replace('{done}', toArabicDigits(d.completedCount || 0))
      .replace('{total}', toArabicDigits(d.unitCount))
      .replace('{unit}', T(d.unitType === 'page' ? 'khatma_group.unit_page_word' : 'khatma_group.unit_juz_word', d.unitType === 'page' ? 'صفحة' : 'جزء'));
    if (meta) {
      const membersLine = `${(d.memberUids || []).length} ${T('khatma_group.members_word', 'عضو')}`;
      const dateLine = d.continuous
        ? T('khatma_group.continuous_badge', 'مستمرة')
        : (d.endDate ? `${T('khatma_group.ends_on', 'حتى')} ${fmtDate(new Date(d.endDate).getTime())}` : '');
      const roundsLine = d.continuous && d.roundsCompleted
        ? T('khatma_group.rounds_completed', 'اكتملت {n} مرة').replace('{n}', toArabicDigits(d.roundsCompleted))
        : '';
      meta.textContent = [membersLine, dateLine, roundsLine].filter(Boolean).join(' • ');
    }
    if (banner) {
      if (d.status === 'expired') { banner.textContent = T('khatma_group.banner_expired', 'انتهى موعد هذه الختمة'); banner.classList.remove('hidden', 'is-done'); }
      else if (d.status === 'completed') { banner.textContent = T('khatma_group.banner_completed', '🎉 اكتملت الختمة بالكامل'); banner.classList.remove('hidden'); banner.classList.add('is-done'); }
      else banner.classList.add('hidden');
    }
    if (deleteBtn) deleteBtn.classList.toggle('hidden', d.creatorId !== myUid);
    const editBtn = $('#btn-kg-edit');
    const assignBtn = $('#btn-kg-assign');
    if (editBtn) editBtn.classList.toggle('hidden', d.creatorId !== myUid);
    if (assignBtn) assignBtn.classList.toggle('hidden', d.creatorId !== myUid);
    const assignCta = $('#btn-kg-assign-cta');
    if (assignCta) assignCta.classList.toggle('hidden', d.creatorId !== myUid);
    updatePendingBanner();
  }

  function syncDailyReminderPicker(value) {
    const savedPrefs = readDailyReminderPrefs();
    const time = value !== undefined ? (value || '') : (savedPrefs[currentDetailsId] || '');
    const selected = $('#kg-daily-reminder-selected-time');
    const clearButton = $('#btn-kg-daily-reminder-clear');
    const presets = $$('.kg-reminder-preset');
    presets.forEach((button) => button.classList.toggle('active', button.dataset.reminderTime === time));
    if (selected) {
      if (!time) selected.textContent = T('khatma_group.daily_reminder_empty', 'لم يتم اختيار موعد');
      else {
        const [hour, minute] = time.split(':').map(Number);
        const lang = (window.appI18n && window.appI18n.getSavedLang && window.appI18n.getSavedLang()) || 'ar';
        selected.textContent = new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit' })
          .format(new Date(2000, 0, 1, hour, minute));
      }
    }
    if (clearButton) clearButton.classList.toggle('hidden', !savedPrefs[currentDetailsId]);
  }

  /* -------- ترتيب ثابت لأعضاء الختمة الجماعية --------
     Firestore ما بيحفظش ترتيب مفاتيح الحقل من نوع map، فلو اعتمدنا على
     Object.keys(members) مباشرة، ترتيب ظهور الأعضاء ممكن يتغيّر من قراءة
     لقراءة تانية من غير أي فعل من المستخدم (حسب ترتيب رجوع البيانات من
     الخادم)، وده اللي كان بيظهر كـ"ترتيب الأعضاء بيتغيّر لوحده". الحل: نرتّب
     دايمًا بنفس المعيار الثابت (تاريخ الانضمام، والمنشئ أولًا) بدل الاعتماد
     على ترتيب المفاتيح كما هو */
  function sortedMemberUids(members) {
    return Object.keys(members).sort((a, b) => {
      const ja = (members[a] && members[a].joinedAt) || 0;
      const jb = (members[b] && members[b].joinedAt) || 0;
      if (ja !== jb) return ja - jb;
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }

  /* -------- توزيع الأجزاء على الأعضاء (شاشة المنشئ) -------- */
  let assignSelectedUid = null;

  function renderAssignMembers() {
    const wrap = $('#kg-assign-members');
    if (!wrap || !currentDetailsData) return;
    const members = currentDetailsData.members || {};
    wrap.innerHTML = sortedMemberUids(members).map((uid) => `
      <button type="button" class="kg-assign-chip${uid === assignSelectedUid ? ' is-active' : ''}" data-uid="${uid}">${escapeHTML(members[uid].name || '—')}</button>
    `).join('');
  }

  function renderAssignGrid() {
    const grid = $('#kg-assign-grid');
    if (!grid || !currentDetailsData) return;
    const d = currentDetailsData;
    grid.classList.toggle('is-pages', d.unitType === 'page');
    const members = d.members || {};
    let html = '';
    for (let n = 1; n <= d.unitCount; n++) {
      const u = (d.units || {})[n];
      const mine = u && u.uid === assignSelectedUid;
      const cls = !u ? '' : mine ? 'is-mine' : 'is-others';
      const ownerName = u ? ((members[u.uid] && members[u.uid].name) || u.name || '') : '';
      const initial = ownerName ? escapeHTML(ownerName.trim().charAt(0)) : '';
      html += `<button type="button" class="kg-unit-cell ${cls}" data-unit="${n}">${toArabicDigits(n)}${initial ? `<span class="kg-unit-owner">${initial}</span>` : ''}</button>`;
    }
    grid.innerHTML = html;
  }

  function openAssignOverlay() {
    $('#kg-details-more-menu').classList.add('hidden');
    if (!currentDetailsData || currentDetailsData.creatorId !== myUid) return;
    assignSelectedUid = null;
    renderAssignMembers();
    renderAssignGrid();
    openOverlay('#khatma-group-assign-overlay');
  }

  /* -------- قائمة الأعضاء: عضو يعدّل اسمه هو، والمنشئ يشيل أي عضو -------- */
  function renderMembersList() {
    const list = $('#kg-members-list');
    if (!list || !currentDetailsData) return;
    const d = currentDetailsData;
    const members = d.members || {};
    const iAmAdmin = d.creatorId === myUid;
    const addByIdWrap = $('#kg-add-by-id-wrap');
    if (addByIdWrap) addByIdWrap.classList.toggle('hidden', !iAmAdmin);
    let head = '';
    if (iAmAdmin) {
      const tl = escapeHTML(T('khatma_group.require_approval', 'الانضمام يحتاج موافقتي'));
      head += `
        <label class="kg-approval-toggle-row">
          <span class="khatma-preset-text"><strong>${tl}</strong></span>
          <span class="kg-switch">
            <input type="checkbox" role="switch" data-kg-require-approval="1" aria-label="${tl}" ${d.requireApproval ? 'checked' : ''}>
            <span class="kg-switch-track" aria-hidden="true"></span>
          </span>
        </label>`;
      const pending = d.pending || {};
      const pUids = Object.keys(pending).sort((a, b) => ((pending[a] && pending[a].requestedAt) || 0) - ((pending[b] && pending[b].requestedAt) || 0));
      if (pUids.length) {
        const ht = escapeHTML(T('khatma_group.pending_title', 'طلبات الانضمام'));
        const okL = escapeHTML(T('khatma_group.approve_aria', 'قبول'));
        const noL = escapeHTML(T('khatma_group.reject_aria', 'رفض'));
        head += `<p style="font-weight:700;margin:12px 4px 4px">${ht} (${toArabicDigits(pUids.length)})</p>`;
        head += pUids.map((uid) => `
        <div class="khatma-preset-row">
          <span class="khatma-preset-radio"><svg><use href="#icon-users"></use></svg></span>
          <span class="khatma-preset-text"><strong>${escapeHTML(pending[uid].name || '—')}</strong></span>
          <button type="button" class="kg-member-action" data-kg-approve-uid="${escapeHTML(uid)}" aria-label="${okL}" style="font-size:20px">✓</button>
          <button type="button" class="kg-member-action is-danger" data-kg-reject-uid="${escapeHTML(uid)}" aria-label="${noL}" style="font-size:20px">✕</button>
        </div>`).join('');
        head += `<p style="font-weight:700;margin:12px 4px 4px">${escapeHTML(T('khatma_group.members_title', 'الأعضاء'))}</p>`;
      }
    }
    list.innerHTML = head + (sortedMemberUids(members).map((uid) => {
      // اسمي هنا للعرض بس دلوقتي: تعديله بقى من "بروفايلي" فقط (زرار
      // btn-khatma-profile في شريط الختمة العلوي) عشان يبقى نفس الاسم في
      // كل ختماتي، مش قابل للتعديل من جوّه كل ختمة لوحدها
      let action = '';
      if (uid !== myUid && iAmAdmin) {
        const lbl = escapeHTML(T('khatma_group.remove_member_aria', 'إزالة العضو'));
        action = `<button type="button" class="kg-member-action is-danger" data-kg-remove-uid="${escapeHTML(uid)}" aria-label="${lbl}"><svg><use href="#icon-trash"></use></svg></button>`;
      }
      return `
        <div class="khatma-preset-row">
          <span class="khatma-preset-radio"><svg><use href="#icon-users"></use></svg></span>
          <span class="khatma-preset-text"><strong>${escapeHTML(members[uid].name || '—')}${uid === d.creatorId ? ' <span class=\"kg-admin-badge\" role=\"img\" aria-label=\"منشئ الختمة\" title=\"منشئ الختمة\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><circle cx=\"12\" cy=\"7.2\" r=\"3.4\"></circle><path d=\"M5 20v-1.2a7 7 0 0 1 14 0V20z\"></path></svg></span>' : ''}</strong></span>
          ${action}
        </div>`;
    }).join('') || `<p class="khatma-history-empty">${escapeHTML(T('khatma_group.no_members', 'لا يوجد أعضاء بعد'))}</p>`);
  }

  // شريط تنبيه للمنشئ في شاشة التفاصيل لما يكون فيه طلبات انضمام معلّقة
  function updatePendingBanner() {
    const d = currentDetailsData;
    let el = document.getElementById('kg-pending-banner');
    const count = d && d.creatorId === myUid ? Object.keys(d.pending || {}).length : 0;
    if (!el) {
      const anchor = $('#kg-status-banner');
      if (!anchor || !anchor.parentNode) return;
      el = document.createElement('div');
      el.id = 'kg-pending-banner';
      el.style.cssText = 'margin:8px 0;padding:10px 12px;border-radius:12px;text-align:center;font-weight:600;cursor:pointer;background:rgba(212,175,55,.16)';
      el.addEventListener('click', () => { renderMembersList(); openOverlay('#khatma-group-members-overlay'); });
      anchor.parentNode.insertBefore(el, anchor.nextSibling);
    }
    if (!count) { el.classList.add('hidden'); el.style.display = 'none'; return; }
    el.style.display = '';
    el.classList.remove('hidden');
    el.textContent = T('khatma_group.pending_banner', '🔔 {n} طلب انضمام بانتظار موافقتك').replace('{n}', toArabicDigits(count));
  }

  function openMyNameOverlay() {
    $('#kg-details-more-menu').classList.add('hidden');
    if (!currentDetailsData) return;
    closeOverlay('#khatma-group-members-overlay');
    const me = (currentDetailsData.members || {})[myUid];
    $('#kg-myname-input').value = (me && me.name) || getMyName();
    openOverlay('#khatma-group-myname-overlay');
  }

  function openDetails(id) {
    currentDetailsId = id;
    selectedUnit = null;
    unitFilter = 'all'; unitSearchQuery = ''; unitPageWindow = 0;
    const unitSearch = $('#kg-unit-search'); if (unitSearch) unitSearch.value = '';
    $$('#kg-unit-filters [data-unit-filter]').forEach((b) => b.classList.toggle('active', b.dataset.unitFilter === 'all'));
    leavingGroupId = null;
    if (typeof recordLastKhatmaOpened === 'function') recordLastKhatmaOpened('group', id);
    if (unsubDetails) { unsubDetails(); unsubDetails = null; }
    openOverlay('#khatma-group-details-overlay');
    unsubDetails = subscribeGroup(id, async (data) => {
      // لو منشئ الختمة شالني منها وأنا فاتحها: نقفل الشاشة ونبلّغني
      if (id === currentDetailsId && leavingGroupId !== id && Array.isArray(data.memberUids) && myUid && !data.memberUids.includes(myUid)) {
        if (readingSession && readingSession.khatmaId === id) { readingSession = null; saveReadingSession(null); updateReadingBar(); }
        ['#khatma-group-members-overlay', '#khatma-group-assign-overlay', '#khatma-group-edit-overlay',
         '#khatma-group-myname-overlay'].forEach((sel) => closeOverlay(sel));
        closeDetails();
        showToast(T('khatma_group.toast_removed_by_admin', 'تمت إزالتك من هذه الختمة بواسطة منشئها'), 4500);
        return;
      }
      const checked = await checkExpiryLocally(id, data);
      const wasActive = currentDetailsData && currentDetailsData.status === 'active';
      const prevRounds = currentDetailsData ? (currentDetailsData.roundsCompleted || 0) : 0;
      if (currentDetailsData) notifyGroupEventsAsToast(collectGroupEvents([currentDetailsData], [checked]));
      currentDetailsData = checked;
      renderDetailsHeader();
      renderUnitsGrid();
      renderSelectedCard();
      const assignOverlay = $('#khatma-group-assign-overlay');
      if (assignOverlay && assignOverlay.classList.contains('open')) { renderAssignMembers(); renderAssignGrid(); }
      const membersOverlay = $('#khatma-group-members-overlay');
      if (membersOverlay && membersOverlay.classList.contains('open')) renderMembersList();
      if (checked.status === 'completed' && wasActive !== false && !celebratedIds.has(id)) {
        markCelebrated(id);
        openCelebration(checked.title);
      } else if (checked.continuous && (checked.roundsCompleted || 0) > prevRounds) {
        // ختمة مستمرة: أي عضو فاتح شاشة التفاصيل وقت ما دورة تكتمل (حتى لو
        // مش هو اللي قرأ آخر جزء فيها) بيشوف احتفال الدورة برضه
        markRoundSeen(id, checked.roundsCompleted);
        openCelebration(checked.title, { continuous: true, round: checked.roundsCompleted });
      }
    });
  }

  function closeDetails() {
    if (unsubDetails) { unsubDetails(); unsubDetails = null; }
    currentDetailsId = null;
    currentDetailsData = null;
    selectedUnit = null;
    closeOverlay('#khatma-group-details-overlay');
    refreshHub();
  }

  function openCelebration(title, opts) {
    $('#kg-celebrate-name').textContent = title;
    $('#kg-dua-box').classList.add('hidden');
    const subEl = $('#kg-celebrate-sub');
    if (subEl) {
      if (opts && opts.continuous) {
        subEl.textContent = T('khatma_group.celebrate_sub_continuous', 'تقبّل الله من الجميع، وبدأت دورة جديدة تلقائيًا')
          + (opts.round ? ` (${T('khatma_group.rounds_completed', 'اكتملت {n} مرة').replace('{n}', toArabicDigits(opts.round))})` : '');
      } else {
        subEl.textContent = T('khatma_group.celebrate_sub', 'تقبّل الله من الجميع');
      }
    }
    openOverlay('#khatma-group-celebrate-overlay');
  }

  /* ================================================================== */
  /* 5.5) جلسة قراءة جزء/صفحة من ختمة جماعية: بتفتح المصحف على أول صفحة  */
  /*      (أو آخر صفحة وصلها العضو لو رجع لنفس الجزء من غير ما يخلّصه)،  */
  /*      وبتتابع كل صفحة بتتفتح (شوف حدث mushaf:page-viewed اللي app.js */
  /*      بيبعته من جوّه recordKhatmaPageRead) لحد ما توصل آخر صفحة في   */
  /*      نطاق الجزء/الصفحة، فتسجّله "تمّت قراءته" تلقائيًا وترجّع العضو  */
  /*      لصفحة الختمة الجماعية. الجلسة محفوظة محليًا (localStorage) عشان */
  /*      لو العضو قفل التطبيق قبل ما يخلّص، يرجعله بالظبط عند نفس الصفحة */
  /* ================================================================== */
  const READING_SESSION_KEY = 'almus-hraf:kgReadingSession';
  function loadReadingSession() {
    try { return JSON.parse(localStorage.getItem(READING_SESSION_KEY) || 'null'); } catch (e) { return null; }
  }
  function saveReadingSession(s) {
    try {
      if (s) localStorage.setItem(READING_SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(READING_SESSION_KEY);
    } catch (e) { /* تجاهل */ }
  }
  let readingSession = loadReadingSession();

  function isQuranTabActive() {
    const el = document.getElementById('view-quran');
    return !!(el && el.classList.contains('active'));
  }

  function updateReadingBar() {
    const bar = $('#kg-reading-bar');
    if (!bar) return;
    // الشريط ميظهرش إلا لو فيه جلسة قراءة "نشطة" فعلًا (يعني المستخدم لسه
    // جوّه تجربة قراءة الختمة الجماعية دي)، مش بس لمجرد إن فيه جلسة متحفوظة
    // من قبل كده. لو المستخدم ضغط X للخروج (exitReadingSessionToDetails)
    // بنسيب الجلسة نفسها محفوظة (عشان يكمّل من نفس الصفحة تاني لو رجع
    // يقرا)، لكن بنطفي علم "active"، فالشريط ميفضلش تابعه في قراءة المصحف
    // العادية بعد كده لحد ما يدوس "اقرأ الجزء/أعد القراءة" تاني
    if (!readingSession || !readingSession.active || !isQuranTabActive()) {
      bar.classList.add('hidden');
      bar.setAttribute('aria-hidden', 'true');
      notifyReadingSessionChanged();
      return;
    }
    const { startPage, endPage, lastPage, unitType, unit } = readingSession;
    const total = endPage - startPage + 1;
    const done = Math.min(total, Math.max(1, lastPage - startPage + 1));
    const pct = Math.round((done / total) * 100);
    bar.classList.remove('hidden');
    bar.setAttribute('aria-hidden', 'false');
    if (window.positionMushafReadingBar) window.positionMushafReadingBar(bar);
    const fill = $('#kg-reading-bar-fill');
    if (fill) fill.style.width = pct + '%';
    const label = $('#kg-reading-bar-label');
    if (label) {
      label.textContent = `${unitLabel(unitType, unit)} — ${T('khatma_group.reading_bar_progress', 'صفحة {done} من {total}')
        .replace('{done}', toArabicDigits(done)).replace('{total}', toArabicDigits(total))}`;
    }
    notifyReadingSessionChanged();
  }

  // بيبلّغ app.js (كبسولة "تقدّم القراءة" العائمة فوق صفحة المصحف،
  // mtt-khatma-pill) إن حالة جلسة القراءة الجماعية اتغيّرت، عشان يحدّث
  // ظهورها/بياناتها فورًا بدل ما يستنى تحميل صفحة جديدة — شوف
  // updateMttKhatmaPill في app.js
  function notifyReadingSessionChanged() {
    try { window.dispatchEvent(new CustomEvent('kg:reading-session-changed')); } catch (e) { /* تجاهل */ }
  }

  // شاشة المصحف نفسها (#view-quran) هي اللي بياخد/بيشيل كلاس "active" لما
  // المستخدم يقلّب التابات من الشريط السفلي — فبنراقب الكلاس ده مباشرة
  // بدل ما نعتمد بس على وجود الجلسة، عشان الشريط يختفي فورًا لو المستخدم
  // مشى بعيد عن المصحف (حتى لو مضغطش زرار "رجوع للختمة" تحديدًا)، ويظهر
  // تاني لو رجع لتاب المصحف والجلسة لسه شغّالة
  try {
    const quranViewEl = document.getElementById('view-quran');
    if (quranViewEl && window.MutationObserver) {
      new MutationObserver(() => updateReadingBar()).observe(quranViewEl, { attributes: true, attributeFilter: ['class'] });
    }
  } catch (e) { /* تجاهل */ }

  function startReadingSession(khatmaId, khatmaTitle, unitType, unit) {
    const startPage = unitStartPage(unitType, unit);
    const endPage = unitEndPage(unitType, unit);
    // لو فيه جلسة سابقة واقفة لسه في نفس الختمة/نفس الجزء وما خلصتوش،
    // كمّل من عندها بدل ما تبدأ من الأول تاني
    const resumeFrom = (readingSession && readingSession.khatmaId === khatmaId && readingSession.unit === unit
      && readingSession.unitType === unitType && readingSession.lastPage >= startPage && readingSession.lastPage <= endPage)
      ? readingSession.lastPage : startPage;
    readingSession = { khatmaId, khatmaTitle, unitType, unit, startPage, endPage, lastPage: resumeFrom, active: true };
    saveReadingSession(readingSession);
    closeOverlay('#khatma-group-details-overlay');
    switchToTab('quran');
    updateReadingBar();
    jumpToPage(resumeFrom);
  }

  // "رجوع للختمة" من شريط التقدّم: بتسيب الجلسة زي ما هي محفوظة (يقدر
  // يكمّل منها تاني لما يدوس "اقرأ" تاني)، لكن بتطفي علم "active" عشان
  // الشريط ميفضلش شغّال ويظهر تاني في أي قراءة عادية للمصحف بعد كده —
  // هيظهر بس تاني لو المستخدم دخل يقرا من جوّه الختمة الجماعية تاني
  function exitReadingSessionToDetails() {
    if (!readingSession) return;
    const { khatmaId } = readingSession;
    readingSession.active = false;
    saveReadingSession(readingSession);
    switchToTab('home');
    updateReadingBar();
    openDetails(khatmaId);
  }

  // بينادى مع كل صفحة بتتفتح في المصحف (تقليب يدوي أو تمرير تلقائي)
  async function onMushafPageViewed(pageNumber) {
    if (!readingSession) return;
    const { khatmaId, unit, unitType, startPage, endPage } = readingSession;
    if (pageNumber < startPage || pageNumber > endPage) return; // برّه نطاق الجزء الحالي، سيبها زي ما هي
    readingSession.lastPage = pageNumber;
    saveReadingSession(readingSession);
    updateReadingBar();
    if (pageNumber !== endPage) return;

    // وصل آخر صفحة في الجزء/الصفحة المطلوبة — نسجّله "تمّت قراءته" تلقائيًا
    readingSession = null;
    saveReadingSession(null);
    updateReadingBar();
    try {
      const justCompleted = await completeUnit(khatmaId, unit);
      showToast(T('khatma_group.toast_done', 'تمّت القراءة، تقبّل الله'));
      setTimeout(() => {
        switchToTab('home');
        openDetails(khatmaId);
        if (justCompleted) {
          markCelebrated(khatmaId);
          openCelebration(currentDetailsData ? currentDetailsData.title : '');
        }
      }, 900);
    } catch (e) { showToast(friendlyError(e), 4000); }
  }
  window.addEventListener('mushaf:page-viewed', (ev) => { onMushafPageViewed(ev && ev.detail && ev.detail.pageNumber); });

  const KHATM_DUA_TEXT = [
    'اللهمَّ ارحمني بالقرآن، واجعله لي إمامًا ونورًا وهدًى ورحمة.',
    'اللهمَّ ذكِّرني منه ما نُسِّيت، وعلِّمني منه ما جهِلت، وارزقني تلاوته آناء الليل وأطراف النهار.',
    'اللهمَّ اجعل القرآن العظيم ربيع قلوبنا، وجلاء أحزاننا، وذهاب همومنا وغمومنا.',
    'اللهمَّ تقبّل منّا هذه الختمة، واجعلها في موازين حسناتنا، وحسنات من قرأ معنا.'
  ].join('<br><br>');

  /* ================================================================== */
  /* 6) نموذج إنشاء ختمة جماعية + الانضمام بكود + المشاركة               */
  /* ================================================================== */
  let createPrivacy = 'private';
  let createUnit = 'juz';
  let createStep = 1;

  // رابط https (Firebase Hosting) هو اللي بيتبعت في الرسالة، لأن واتساب وباقي
  // التطبيقات بتعمله لينك قابل للضغط (السكيم المخصّص almushafalashraf:// مش
  // بيتحوّل للينك عندهم). لو App Links متفعّلة على الأندرويد (شوف
  // ANDROID_APP_LINKS_SETUP.md) الضغط عليه بيفتح التطبيق على الختمة مباشرة،
  // ولو التطبيق مش مركّب بيفتح نسخة الويب على نفس الختمة
  function buildInviteLink(code) {
    const projectId = (window.FIREBASE_KHATMA_CONFIG || {}).projectId;
    return projectId
      ? `https://${projectId}.web.app/?khatmaCode=${code}`
      : `almushafalashraf://khatmah/join?code=${code}`;
  }

  function isShareCancel(e) {
    const msg = String((e && (e.message || e.errorMessage)) || e || '');
    return (e && e.name === 'AbortError') || /cancel/i.test(msg);
  }

  function copyInviteText(text, fallbackToast) {
    const done = () => showToast(T('khatma_group.toast_copied', 'تم نسخ رابط الدعوة'));
    const legacy = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        ok ? done() : showToast(fallbackToast);
      } catch (e) { showToast(fallbackToast); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(legacy);
    else legacy();
  }

  // زر المشاركة: قائمة المشاركة الأصلية للنظام (واتساب/تليجرام/إلخ) — النسخ
  // بقى مجرد احتياطي لو مفيش أي طريقة مشاركة متاحة
  async function shareInvite(khatma) {
    const link = buildInviteLink(khatma.inviteCode);
    const text = T('khatma_group.share_text', 'انضم إليّ في ختمة «{name}» على تطبيق المصحف الأشرف 🌙\nرمز الدعوة: {code}\n{link}')
      .replace('{name}', khatma.title).replace('{code}', khatma.inviteCode).replace('{link}', link);
    const dialogTitle = T('khatma_group.share_dialog', 'مشاركة الختمة');

    // 1) داخل التطبيق (Capacitor): navigator.share مش مدعوم في WebView الأندرويد،
    // فبنستخدم بلجن Share الأصلي (نفس البلجن المستخدم في مشاركة الآيات).
    // الرابط جوّه النص نفسه (من غير حقل url) عشان ما يتكررش في الرسالة
    const nativeShare = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Share;
    if (nativeShare && nativeShare.share) {
      try { await nativeShare.share({ title: khatma.title, text, dialogTitle }); return; }
      catch (e) { if (isShareCancel(e)) return; }
    }
    // 2) متصفح/PWA بيدعم Web Share API
    if (navigator.share) {
      try { await navigator.share({ title: khatma.title, text }); return; }
      catch (e) { if (isShareCancel(e)) return; }
    }
    // 3) احتياطي أخير: نسخ
    copyInviteText(text, khatma.inviteCode);
  }

  // رابط الدعوة يعرض معاينة للختمة أولًا، ويترك الانضمام باختيار المستخدم.
  let lastInvite = { code: '', at: 0 };
  let pendingInvite = null;
  function openInvitedKhatma(rawCode) {
    const code = String(rawCode || '').trim().toUpperCase();
    if (!code) return;
    const now = Date.now();
    if (lastInvite.code === code && now - lastInvite.at < 5000) return; // نفس الرابط وصل من أكتر من مصدر
    lastInvite = { code, at: now };
    needsName(async () => {
      try {
        const found = await findByCode(code);
        if (found.data.status !== 'active') throw new Error('expired');
        if ((found.data.memberUids || []).includes(myUid)) {
          openDetails(found.id);
          return;
        }
        pendingInvite = { id: found.id, code };
        $('#kg-invite-title').textContent = found.data.title || T('khatma_group.default_title', 'ختمة جماعية');
        $('#kg-invite-meta').textContent = `${(found.data.memberUids || []).length} ${T('khatma_group.members_word', 'عضو')} • ${toArabicDigits(found.data.completedCount || 0)} / ${toArabicDigits(found.data.unitCount || 30)} ${T(found.data.unitType === 'page' ? 'khatma_group.unit_page_word' : 'khatma_group.unit_juz_word', found.data.unitType === 'page' ? 'صفحة' : 'جزء')}`;
        $('#kg-invite-status').classList.add('hidden');
        const joinButton = $('#btn-kg-invite-join');
        joinButton.disabled = false;
        joinButton.textContent = T('khatma_group.join_btn_short', 'انضمام');
        const openAppButton = $('#btn-kg-invite-open-app');
        const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
        if (openAppButton) openAppButton.classList.toggle('hidden', isNative || !/Android/i.test(navigator.userAgent));
        openOverlay('#khatma-group-invite-overlay');
        refreshHub().catch(() => {});
      } catch (e) {
        $('#kg-join-code').value = code;
        const errEl = $('#kg-join-error');
        errEl.textContent = friendlyError(e);
        errEl.classList.remove('hidden');
        openOverlay('#khatma-group-join-overlay');
      }
    });
  }
  function inviteCodeFromUrl(url) {
    const m = /[?&](?:khatmaCode|code)=([A-Za-z0-9]+)/.exec(String(url || ''));
    return m ? m[1] : '';
  }
  // نقطة دخول عامة: كود الأندرويد (MainActivity) يقدر ينادي عليها مباشرة
  // بأي رابط اتفتح بيه التطبيق، من غير ما يعتمد على بلجن @capacitor/app
  window.__openKhatmaInviteUrl = (url) => openInvitedKhatma(inviteCodeFromUrl(url));

  /* ================================================================== */
  /* 7) ربط الأزرار كلها                                                 */
  /* ================================================================== */
  function needsName(onDone) {
    const name = getMyName();
    if (name) { onDone(); return; }
    $('#kg-name-input').value = '';
    openOverlay('#khatma-name-prompt-overlay');
    const save = () => {
      const v = $('#kg-name-input').value.trim();
      if (!v) return;
      setMyName(v);
      closeOverlay('#khatma-name-prompt-overlay');
      $('#btn-kg-name-save').removeEventListener('click', save);
      onDone();
    };
    $('#btn-kg-name-save').addEventListener('click', save);
  }

  // الزرارين اللي كانا بيفتحوا نموذج الختمة الفردية على طول، المفروض يفتحوا
  // اختيار "فردية / جماعية" الأول، بدل ما يفتح app.js نموذج الختمة الفردية
  // (#khatma-add-overlay) فورًا زي الأول.
  //
  // ملحوظة عن الترتيب (مهمة عشان الحل يشتغل صح): هذا الملف script[defer]،
  // فبينفّذ (ومعاه الكود ده) بعد ما الصفحة كلها تتحلّل لكن *قبل* حدث
  // DOMContentLoaded؛ أما app.js فمش مؤجّل (مفيش defer عليه في index.html)
  // وبيربط زرّاره هو جوّه مستمع DOMContentLoaded، يعني بعد الكود ده بترتيب
  // مضمون دايمًا. فلو ضفنا مستمعنا هنا على طول (مش بعد ما app.js يضيف
  // بتاعه)، مستمعنا هيبقى الأول اللي اتضاف على الزرار، ومستمع app.js هيتضاف
  // بعده. بما إن المستمعات بتتنفّذ بترتيب إضافتها، مستمعنا هيشتغل الأول،
  // وجواه بنوقف باقي المستمعات على نفس الحدث (stopImmediatePropagation) عشان
  // مستمع app.js ما يشتغلش خالص — مش محتاجين ننتظر حدث 'load' (اللي ممكن
  // يتأخر كتير أو ميحصلش أصلًا لو فيه ريكوست عالقة/التطبيق أوفلاين)، ولا
  // نستبدل الزرار بنسخة (clone) لشيل مستمع لسه ما اتضافش أصلًا وقت التنفيذ.
  function wireAddButtons() {
    const openTypePicker = (ev) => {
      if (ev) { ev.stopImmediatePropagation(); ev.preventDefault(); }
      // شبكة أمان إضافية: نتأكد إن نموذج الختمة الفردية مقفول فعلًا قبل
      // ما نفتح شاشة الاختيار، حتى لو بأي سبب فاضل مفتوح من ورا
      closeOverlay('#khatma-add-overlay');
      openOverlay('#khatma-type-overlay');
    };
    const btnAdd = $('#btn-khatma-add');
    const btnEmptyAdd = $('#btn-khatma-empty-add');
    if (btnAdd) btnAdd.addEventListener('click', openTypePicker);
    if (btnEmptyAdd) btnEmptyAdd.addEventListener('click', openTypePicker);
  }
  wireAddButtons();

  function init() {

    wireOnboarding();
    wireRestoreOverlay();

    $('#btn-kg-type-close').addEventListener('click', () => closeOverlay('#khatma-type-overlay'));
    $('#btn-kg-type-solo').addEventListener('click', () => {
      closeOverlay('#khatma-type-overlay');
      const nameInput = $('#khatma-name-input');
      const title = $('#khatma-form-title');
      if (nameInput) nameInput.value = '';
      if (title) title.textContent = T('khatma_add.title', 'أضف ختمة جديدة');
      openOverlay('#khatma-add-overlay');
    });
    $('#btn-kg-type-group').addEventListener('click', () => {
      closeOverlay('#khatma-type-overlay');
      closeOverlay('#khatma-add-overlay'); // شبكة أمان: التأكد إن نموذج الختمة الفردية مش فاضل فاتح من ورا
      needsName(() => { openOverlay('#khatma-group-hub-overlay'); refreshHub(); });
    });

    // -------- مركز الختمات الجماعية --------
    $('#btn-kg-hub-close').addEventListener('click', () => closeOverlay('#khatma-group-hub-overlay'));
    initDragToClose('#khatma-group-hub-overlay .khatma-details-topbar', '#khatma-group-hub-overlay .overlay-sheet', () => closeOverlay('#khatma-group-hub-overlay'));

    $('#btn-kg-open-create').addEventListener('click', () => {
      $('#kg-create-name').value = '';
      $('#kg-create-end-date').value = '';
      createPrivacy = 'private'; createUnit = 'juz';
      $$('.khatma-segmented-btn[data-privacy]').forEach((b) => b.classList.toggle('active', b.dataset.privacy === 'private'));
      $$('.khatma-segmented-btn[data-unit]').forEach((b) => b.classList.toggle('active', b.dataset.unit === 'juz'));
      const contToggle = $('#kg-create-continuous-toggle');
      if (contToggle) contToggle.checked = false;
      applyCreateContinuousUI(false);
      openOverlay('#khatma-group-create-overlay');
    });
    $('#btn-kg-open-join').addEventListener('click', () => {
      $('#kg-join-code').value = '';
      $('#kg-join-error').classList.add('hidden');
      openOverlay('#khatma-group-join-overlay');
    });

    $('#btn-kg-toggle-public').addEventListener('click', async (e) => {
      const box = $('#kg-public-list');
      const willShow = box.classList.contains('hidden');
      box.classList.toggle('hidden');
      if (willShow) {
        box.innerHTML = `<p class="khatma-history-empty">${escapeHTML(T('khatma_group.loading', 'جارٍ التحميل...'))}</p>`;
        try { renderPublicGroupsList(await listPublicGroups()); }
        catch (err) { box.innerHTML = `<p class="khatma-history-empty">${escapeHTML(friendlyError(err))}</p>`; }
      }
    });

    $('#kg-my-list').addEventListener('click', (ev) => {
      const row = ev.target.closest('[data-kg-open]');
      if (row) openDetails(row.dataset.kgOpen);
    });
    $('#kg-public-list').addEventListener('click', async (ev) => {
      const row = ev.target.closest('[data-kg-join-code]');
      if (!row) return;
      try {
        const r = await joinByCode(row.dataset.kgJoinCode);
        if (r.status === 'pending') { showToast(T('khatma_group.toast_join_pending', 'تم إرسال طلب الانضمام، وهو في انتظار موافقة منشئ الختمة'), 5000); return; }
        showToast(T('khatma_group.toast_joined', 'تم الانضمام إلى الختمة')); openDetails(r.id); await refreshHub();
      }
      catch (err) { showToast(friendlyError(err)); }
    });

    // -------- نموذج الإنشاء --------
    $('#btn-kg-create-cancel').addEventListener('click', () => closeOverlay('#khatma-group-create-overlay'));
    $('#kg-create-privacy').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-privacy]'); if (!b) return;
      createPrivacy = b.dataset.privacy;
      $$('.khatma-segmented-btn[data-privacy]').forEach((x) => x.classList.toggle('active', x === b));
    });
    $('#kg-create-unit').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-unit]'); if (!b) return;
      createUnit = b.dataset.unit;
      $$('.khatma-segmented-btn[data-unit]').forEach((x) => x.classList.toggle('active', x === b));
    });
    // -------- ختمة مستمرة: بدون تاريخ انتهاء، حقل التاريخ بيتعطّل وقت تفعيلها --------
    function applyCreateContinuousUI(on) {
      const dateInput = $('#kg-create-end-date');
      const hint = $('#kg-create-continuous-hint');
      if (dateInput) {
        dateInput.disabled = on;
        if (on) dateInput.value = '';
      }
      if (hint) hint.classList.toggle('hidden', !on);
    }
    const kgContToggle = $('#kg-create-continuous-toggle');
    if (kgContToggle) kgContToggle.addEventListener('change', () => applyCreateContinuousUI(kgContToggle.checked));
    applyCreateContinuousUI(false);
    $('#btn-kg-create-save').addEventListener('click', async () => {
      const btn = $('#btn-kg-create-save');
      if (btn.disabled) return; // منع ضغطتين سريعتين فوق بعض
      // ملاحظة: لو الكيبورد كان لسه فاتح، أول لمسة على أي زرار على الموبايل
      // أحيانًا بتتاخد كـ"قفل الكيبورد" بس من غير ما الضغطة توصل كـ"كليك"
      // فعلي. بنعمل blur يدوي فورًا هنا كجزء من نفس اللمسة، وأهم حاجة إننا
      // بنغيّر شكل الزرار فورًا (قبل أي await) عشان تبان فيه استجابة للمس
      // حتى لو حصل خطأ بعد كده
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      const originalLabel = btn.textContent;
      const title = $('#kg-create-name').value.trim();
      const continuous = !!($('#kg-create-continuous-toggle') || {}).checked;
      const endDate = continuous ? null : ($('#kg-create-end-date').value || null);
      btn.disabled = true;
      btn.textContent = T('khatma_group.saving', '...جارٍ الحفظ');
      try {
        const khatma = await createGroupKhatma({ title, privacy: createPrivacy, unitType: createUnit, endDate, continuous });
        closeOverlay('#khatma-group-create-overlay');
        showToast(T('khatma_group.toast_created', 'تم إنشاء الختمة، شارك الكود مع من تريد'));
        await refreshHub();
        openDetails(khatma.id);
        setTimeout(() => shareInvite(khatma), 400);
      } catch (e) {
        showToast(friendlyError(e), 4000);
      } finally {
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
    });

    // -------- الانضمام بكود --------
    $('#btn-kg-join-cancel').addEventListener('click', () => closeOverlay('#khatma-group-join-overlay'));
    const doJoin = async () => {
      const code = $('#kg-join-code').value.trim();
      const errEl = $('#kg-join-error');
      errEl.classList.add('hidden');
      if (!code) return;
      try {
        const r = await joinByCode(code);
        closeOverlay('#khatma-group-join-overlay');
        if (r.status === 'pending') { showToast(T('khatma_group.toast_join_pending', 'تم إرسال طلب الانضمام، وهو في انتظار موافقة منشئ الختمة'), 5000); return; }
        showToast(T('khatma_group.toast_joined', 'تم الانضمام إلى الختمة'));
        await refreshHub();
        openDetails(r.id);
      } catch (e) { errEl.textContent = friendlyError(e); errEl.classList.remove('hidden'); }
    };
    $('#btn-kg-join-submit').addEventListener('click', doJoin);

    $('#btn-kg-invite-close').addEventListener('click', () => {
      closeOverlay('#khatma-group-invite-overlay');
      pendingInvite = null;
    });
    $('#btn-kg-invite-open-app').addEventListener('click', () => {
      if (!pendingInvite) return;
      const fallback = `${window.location.origin}${window.location.pathname}?khatmaCode=${encodeURIComponent(pendingInvite.code)}&noapp=1`;
      window.location.href = `intent://khatmah/join?code=${encodeURIComponent(pendingInvite.code)}#Intent;scheme=almushafalashraf;package=com.ashraf.mushaf;S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
    });
    $('#btn-kg-invite-join').addEventListener('click', async () => {
      if (!pendingInvite) return;
      const button = $('#btn-kg-invite-join');
      const status = $('#kg-invite-status');
      button.disabled = true;
      status.classList.add('hidden');
      try {
        const result = await joinByCode(pendingInvite.code);
        if (result.status === 'pending') {
          status.textContent = T('khatma_group.toast_join_pending', 'تم إرسال طلب الانضمام، وهو في انتظار موافقة منشئ الختمة');
          status.classList.remove('hidden');
          pendingInvite = null;
          refreshHub().catch(() => {});
          return;
        }
        const groupId = result.id;
        pendingInvite = null;
        closeOverlay('#khatma-group-invite-overlay');
        openDetails(groupId);
        refreshHub().catch(() => {});
      } catch (e) {
        status.textContent = friendlyError(e);
        status.classList.remove('hidden');
        button.disabled = false;
      }
    });
    $('#kg-join-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase(); });
    $('#kg-join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });

    // -------- شاشة التفاصيل --------
    $('#btn-kg-details-close').addEventListener('click', closeDetails);
    initDragToClose('#khatma-group-details-overlay .khatma-details-topbar', '#khatma-group-details-overlay .overlay-sheet', closeDetails);
    $('#btn-kg-details-share').addEventListener('click', () => { if (currentDetailsData) shareInvite({ ...currentDetailsData, id: currentDetailsId }); });
    $('#btn-kg-details-more').addEventListener('click', () => $('#kg-details-more-menu').classList.toggle('hidden'));
    $$('.kg-reminder-preset').forEach((button) => button.addEventListener('click', () => {
      const input = $('#kg-daily-reminder-time');
      if (!input) return;
      input.value = button.dataset.reminderTime || '';
      syncDailyReminderPicker(input.value);
    }));
    const customReminderInput = $('#kg-daily-reminder-time');
    if (customReminderInput) {
      customReminderInput.addEventListener('input', () => syncDailyReminderPicker(customReminderInput.value));
      customReminderInput.addEventListener('change', () => syncDailyReminderPicker(customReminderInput.value));
    }
    const saveDailyReminder = async (clear = false) => {
      if (!currentDetailsId || !currentDetailsData) return;
      const input = $('#kg-daily-reminder-time');
      if (clear && input) input.value = '';
      const time = !clear && input ? input.value : '';
      const ln = getLocalNotifPlugin();
      if (time && !ln) {
        showToast(T('khatma_group.reminder_native_only', 'تذكير الموعد متاح في تطبيق الهاتف، وليس في نسخة الويب'));
        return;
      }
      if (time && ln) {
        try {
          let permission = await ln.checkPermissions();
          if (permission.display !== 'granted') permission = await ln.requestPermissions();
          if (permission.display !== 'granted') {
            showToast(T('khatma_group.reminder_permission', 'اسمح بالإشعارات من إعدادات الجهاز لتفعيل التذكير'));
            return;
          }
        } catch (e) {
          showToast(T('khatma_group.reminder_permission', 'اسمح بالإشعارات من إعدادات الجهاز لتفعيل التذكير'));
          return;
        }
      }
      const prefs = readDailyReminderPrefs();
      if (time) prefs[currentDetailsId] = time;
      else delete prefs[currentDetailsId];
      writeDailyReminderPrefs(prefs);
      const groups = (myGroupsCache || []).filter((group) => group.id !== currentDetailsId);
      groups.push({ ...currentDetailsData, id: currentDetailsId });
      const scheduled = await scheduleReminders(groups);
      syncDailyReminderPicker(time);
      const reminderPanel = $('#kg-daily-reminder-panel');
      if (reminderPanel) reminderPanel.open = false;
      if (time && !scheduled) {
        showToast(T('khatma_group.reminder_schedule_failed', 'تم حفظ الموعد، لكن تعذرت جدولة الإشعار. تأكد من السماح بإشعارات التطبيق.'));
        return;
      }
      showToast(time
        ? T('khatma_group.reminder_saved', 'تم حفظ موعد وردك اليومي لهذه الختمة')
        : T('khatma_group.reminder_removed', 'تم إيقاف تذكير هذه الختمة'));
    };
    $('#btn-kg-daily-reminder-save').addEventListener('click', () => saveDailyReminder(false));
    $('#btn-kg-daily-reminder-clear').addEventListener('click', () => saveDailyReminder(true));
    // قفل قايمة الإعدادات لما أضغط في أي مكان بره القايمة (من غير ما أحتاج أضغط على الترس تاني)
    // الضغطة اللي بتقفل القايمة بس بتتاخد ومش بتوصل للعنصر اللي تحتها (عشان ما يتحجزش جزء بالغلط)
    document.addEventListener('click', (ev) => {
      const menu = $('#kg-details-more-menu');
      if (!menu || menu.classList.contains('hidden')) return;
      if (menu.contains(ev.target) || ev.target.closest('#btn-kg-details-more') || ev.target.closest('#btn-kg-members')) return;
      menu.classList.add('hidden');
      ev.stopPropagation();
      ev.preventDefault();
    }, true);
    $('#kg-units-grid').addEventListener('click', async (ev) => {
      const cell = ev.target.closest('.kg-unit-cell');
      if (!cell || !currentDetailsData) return;
      const n = Number(cell.dataset.unit);
      const st = unitStatusFor(currentDetailsData, n);
      if (st.state === 'free' && currentDetailsData.status === 'active') {
        try { await claimUnit(currentDetailsId, n); selectedUnit = n; renderSelectedCard(); }
        catch (e) { showToast(friendlyError(e), 6000); }
        return;
      }
      selectedUnit = n;
      renderUnitsGrid();
      renderSelectedCard();
    });
    $('#kg-unit-search').addEventListener('input', (ev) => { unitSearchQuery = ev.target.value || ''; unitPageWindow = 0; renderUnitsGrid(); });
    $('#kg-unit-search-clear').addEventListener('click', () => {
      unitSearchQuery = ''; unitPageWindow = 0;
      const input = $('#kg-unit-search'); if (input) input.value = '';
      renderUnitsGrid();
    });
    $('#kg-unit-filters').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-unit-filter]'); if (!b) return;
      unitFilter = b.dataset.unitFilter || 'all'; unitPageWindow = 0;
      $$('#kg-unit-filters [data-unit-filter]').forEach((x) => x.classList.toggle('active', x === b));
      renderUnitsGrid();
    });
    $('#kg-unit-page-prev').addEventListener('click', () => { unitPageWindow = Math.max(0, unitPageWindow - 1); renderUnitsGrid(); });
    $('#kg-unit-page-next').addEventListener('click', () => { unitPageWindow++; renderUnitsGrid(); });

    $('#btn-kg-members').addEventListener('click', () => {
      $('#kg-details-more-menu').classList.add('hidden');
      if (!currentDetailsData) return;
      renderMembersList();
      openOverlay('#khatma-group-members-overlay');
    });
    $('#kg-members-list').addEventListener('change', async (ev) => {
      const cb = ev.target.closest('[data-kg-require-approval]');
      if (!cb || !currentDetailsData || currentDetailsData.creatorId !== myUid) return;
      const khatmaId = currentDetailsId;
      const val = cb.checked;
      try {
        await setRequireApproval(khatmaId, val);
        if (currentDetailsData && currentDetailsId === khatmaId) currentDetailsData.requireApproval = val;
        showToast(val ? T('khatma_group.toast_approval_on', 'سيحتاج الانضمام إلى موافقتك') : T('khatma_group.toast_approval_off', 'أصبح الانضمام مفتوحًا بالكود'));
      } catch (e) { cb.checked = !val; showToast(friendlyError(e), 4000); }
    });
    $('#kg-members-list').addEventListener('click', async (ev) => {
      if (ev.target.closest('[data-kg-edit-me]')) { openMyNameOverlay(); return; }
      const ap = ev.target.closest('[data-kg-approve-uid]');
      const rj = ev.target.closest('[data-kg-reject-uid]');
      if ((ap || rj) && currentDetailsData && currentDetailsData.creatorId === myUid) {
        const btn = ap || rj;
        const uid = (ap || rj).dataset.kgApproveUid || (ap || rj).dataset.kgRejectUid;
        const khatmaId = currentDetailsId;
        btn.disabled = true;
        try {
          if (ap) await approveRequest(khatmaId, uid); else await rejectRequest(khatmaId, uid);
          const cd = currentDetailsData;
          if (cd && currentDetailsId === khatmaId) {
            const req = (cd.pending || {})[uid];
            if (cd.pending) delete cd.pending[uid];
            if (ap && req) {
              cd.members = cd.members || {};
              cd.members[uid] = { name: req.name || '', joinedAt: Date.now() };
              cd.memberUids = Array.from(new Set([...(cd.memberUids || []), uid]));
            }
            renderMembersList(); renderDetailsHeader();
          }
          showToast(ap ? T('khatma_group.toast_approved', 'تمت الموافقة على العضو') : T('khatma_group.toast_rejected', 'تم رفض الطلب'));
        } catch (e) { showToast(friendlyError(e), 4000); btn.disabled = false; }
        return;
      }
      const rm = ev.target.closest('[data-kg-remove-uid]');
      if (!rm || !currentDetailsData || currentDetailsData.creatorId !== myUid) return;
      const uid = rm.dataset.kgRemoveUid;
      const m = (currentDetailsData.members || {})[uid];
      const who = (m && m.name) || '—';
      if (!confirm(T('khatma_group.confirm_remove_member', 'هل تريد إزالة «{name}» من الختمة؟ ستصبح الأجزاء التي حجزها ولم يقرأها متاحة، بينما تبقى الأجزاء التي قرأها محسوبة ضمن التقدم.').replace('{name}', who))) return;
      rm.disabled = true;
      const khatmaId = currentDetailsId;
      try {
        await removeMember(khatmaId, uid);
        // تحديث فوري محليًا من غير ما ننتظر الـ polling
        const cd = currentDetailsData;
        if (cd && currentDetailsId === khatmaId) {
          cd.memberUids = (cd.memberUids || []).filter((u) => u !== uid);
          if (cd.members) delete cd.members[uid];
          const units = cd.units || {};
          Object.keys(units).forEach((n) => { if (units[n] && units[n].uid === uid && !units[n].done) delete units[n]; });
          renderMembersList();
          renderDetailsHeader();
          renderUnitsGrid();
          renderSelectedCard();
        }
        showToast(T('khatma_group.toast_member_removed', 'تمت إزالة {name} من الختمة').replace('{name}', who));
      } catch (e) { showToast(friendlyError(e), 4000); rm.disabled = false; }
    });

    // -------- تعديل اسمي: بقى من مكان واحد بس (بروفايلي، شوف تحت) —
    // اتشال زرار "تعديل اسمي" من جوّه قايمة إعدادات كل ختمة وكمان القلم
    // جنب اسمي في قايمة الأعضاء (شوف renderMembersList)، عشان الاسم يبقى
    // واحد موحّد لكل ختماتي بدل ما يتغيّر لوحده جوه ختمة معيّنة بس. الأوفرلاي
    // ده (khatma-group-myname-overlay) وrenameMyself فضلوا موجودين لسه: أول
    // واحد بيستخدمه فقط syncNameToOtherGroups داخليًا لمزامنة الاسم في باقي
    // ختماتي الجماعية لما يتغيّر من البروفايلي
    $('#btn-kg-myname-cancel').addEventListener('click', () => closeOverlay('#khatma-group-myname-overlay'));
    const doSaveMyName = async () => {
      const btn = $('#btn-kg-myname-save');
      if (btn.disabled) return;
      const name = $('#kg-myname-input').value.trim();
      if (!name || !currentDetailsId) return;
      const khatmaId = currentDetailsId;
      btn.disabled = true;
      try {
        await renameMyself(khatmaId, name);
        setMyName(name);
        const cd = currentDetailsData;
        if (cd && currentDetailsId === khatmaId) {
          cd.members = cd.members || {};
          cd.members[myUid] = { ...(cd.members[myUid] || {}), name };
          Object.keys(cd.units || {}).forEach((n) => { if (cd.units[n] && cd.units[n].uid === myUid) cd.units[n].name = name; });
          renderSelectedCard();
          renderAssignMembers();
        }
        closeOverlay('#khatma-group-myname-overlay');
        showToast(T('khatma_group.toast_myname', 'تم تغيير اسمك'));
        syncNameToOtherGroups(name, khatmaId); // في الخلفية، من غير انتظار
      } catch (e) { showToast(friendlyError(e), 4000); }
      btn.disabled = false;
    };
    $('#btn-kg-myname-save').addEventListener('click', doSaveMyName);
    $('#kg-myname-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSaveMyName(); });
    $('#btn-kg-members-close').addEventListener('click', () => closeOverlay('#khatma-group-members-overlay'));
    initDragToClose('#khatma-group-members-overlay .nav-sheet-handle', '#khatma-group-members-overlay .overlay-sheet', () => closeOverlay('#khatma-group-members-overlay'));

    // -------- بروفايلي: اسمي + ID ثابت --------
    function fillProfileUI(profile) {
      const initial = (profile.name || '').trim().charAt(0) || '؟';
      $('#kg-profile-avatar').textContent = initial;
      $('#kg-profile-name-text').textContent = profile.name || T('khatma_group.profile_no_name', 'بدون اسم');
      $('#kg-profile-id-text').textContent = profile.code;
      $('#kg-profile-name-input').value = profile.name || '';
      $('#kg-profile-name-edit').classList.add('hidden');
      $('#kg-profile-name-view').classList.remove('hidden');
    }
    async function openProfileOverlay() {
      openOverlay('#khatma-profile-overlay');
      $('#kg-profile-avatar').textContent = '…';
      $('#kg-profile-name-text').textContent = '…';
      $('#kg-profile-id-text').textContent = '••••••••';
      $('#kg-profile-recovery-row').classList.add('hidden');
      $('#btn-kg-profile-recovery-show').classList.remove('hidden');
      try {
        const profile = await getOrCreateMyProfile();
        fillProfileUI(profile);
      } catch (e) { showToast(friendlyError(e), 4000); closeOverlay('#khatma-profile-overlay'); }
    }
    $('#btn-khatma-profile').addEventListener('click', openProfileOverlay);
    $('#btn-kg-profile-close').addEventListener('click', () => closeOverlay('#khatma-profile-overlay'));
    initDragToClose('#khatma-profile-overlay .overlay-head', '#khatma-profile-overlay .overlay-sheet', () => closeOverlay('#khatma-profile-overlay'));

    $('#btn-kg-profile-edit').addEventListener('click', () => {
      $('#kg-profile-name-view').classList.add('hidden');
      $('#kg-profile-name-edit').classList.remove('hidden');
      $('#kg-profile-name-input').focus();
    });
    $('#btn-kg-profile-name-cancel').addEventListener('click', () => {
      $('#kg-profile-name-edit').classList.add('hidden');
      $('#kg-profile-name-view').classList.remove('hidden');
    });
    const doSaveProfileName = async () => {
      const btn = $('#btn-kg-profile-name-save');
      if (btn.disabled) return;
      const name = $('#kg-profile-name-input').value.trim();
      if (!name) return;
      btn.disabled = true;
      try {
        const profile = await updateMyProfileName(name);
        fillProfileUI(profile);
        showToast(T('khatma_group.toast_myname', 'تم تغيير اسمك'));
      } catch (e) { showToast(friendlyError(e), 4000); }
      btn.disabled = false;
    };
    $('#btn-kg-profile-name-save').addEventListener('click', doSaveProfileName);
    $('#kg-profile-name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSaveProfileName(); });
    $('#btn-kg-profile-copy').addEventListener('click', async () => {
      const code = $('#kg-profile-id-text').textContent;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(code);
        showToast(T('khatma_group.toast_id_copied', 'تم نسخ الـ ID'));
      } catch (e) { /* المتصفح رفض النسخ — العرض نفسه كفاية للمستخدم ينسخه يدويًا */ }
    });

    // -------- كود الاسترجاع (بروفايلي) --------
    $('#btn-kg-profile-recovery-show').addEventListener('click', async () => {
      const btn = $('#btn-kg-profile-recovery-show');
      if (btn.disabled) return; // منع ضغطتين سريعتين فوق بعض وهو لسه بيحمّل
      let code = getMyRecoveryCode();
      if (!code) {
        // مفيش نسخة محفوظة على الجهاز ده (مثلًا الجهاز اتغيّر أو الكاش
        // اتمسح من غير ما التطبيق كله ينمسح) — نولّد كود جديد بدل ما نسيبه
        // من غير استرجاع خالص. الكود القديم (لو كان موجود) بيبقى ملغي.
        // العملية دي بتحتاج طلب شبكة فعلي (لربط كود الاسترجاع في حساب
        // جوجل)، ومن غير مؤشر تحميل واضح كانت بتبان للمستخدم كأن الزرار
        // "مش بيعمل حاجة" لثواني طويلة قبل ما يظهر توست "الإنترنت ضعيف" —
        // فبنغيّر شكل/نص الزرار فورًا هنا عشان يبان إنه شغال فعلًا
        const originalLabel = btn.textContent;
        btn.disabled = true;
        btn.textContent = T('khatma_group.recovery_loading', '...جارٍ التحميل');
        try { code = await regenerateRecoveryCode(); }
        catch (e) {
          showToast(friendlyError(e), 4000);
          btn.disabled = false;
          btn.textContent = originalLabel;
          return;
        }
        btn.disabled = false;
        btn.textContent = originalLabel;
        showToast(T('khatma_group.toast_recovery_regenerated', 'تم إنشاء رمز استعادة جديد؛ وأُلغي أي رمز سابق.'), 3500);
      }
      $('#kg-profile-recovery-text').textContent = code;
      $('#kg-profile-recovery-row').classList.remove('hidden');
      btn.classList.add('hidden');
    });
    $('#btn-kg-profile-recovery-copy').addEventListener('click', async () => {
      const code = $('#kg-profile-recovery-text').textContent;
      if (!code || code.indexOf('•') !== -1) return;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(code);
        showToast(T('khatma_group.toast_recovery_copied', 'تم نسخ كود الاسترجاع، احفظه في مكان آمن'));
      } catch (e) { /* تجاهل */ }
    });
    $('#btn-kg-profile-restore-open').addEventListener('click', () => openRestoreOverlay());

    // -------- إضافة عضو مباشرة بالـ ID (لمنشئ الختمة بس) --------
    $('#btn-kg-add-by-id').addEventListener('click', () => {
      if (!currentDetailsData || currentDetailsData.creatorId !== myUid) return;
      $('#kg-addbyid-code').value = '';
      $('#kg-addbyid-error').classList.add('hidden');
      openOverlay('#khatma-group-addbyid-overlay');
    });
    $('#btn-kg-addbyid-cancel').addEventListener('click', () => closeOverlay('#khatma-group-addbyid-overlay'));
    $('#btn-kg-addbyid-submit').addEventListener('click', async () => {
      const btn = $('#btn-kg-addbyid-submit');
      if (btn.disabled) return;
      const code = $('#kg-addbyid-code').value.trim();
      const errEl = $('#kg-addbyid-error');
      errEl.classList.add('hidden');
      if (!code || !currentDetailsId) return;
      const khatmaId = currentDetailsId;
      btn.disabled = true;
      try {
        const res = await addMemberByCode(khatmaId, code);
        closeOverlay('#khatma-group-addbyid-overlay');
        if (res.status === 'already') {
          showToast(T('khatma_group.toast_already_member', 'هذا العضو منضمّ بالفعل'));
        } else {
          const cd = currentDetailsData;
          if (cd && currentDetailsId === khatmaId) { renderMembersList(); renderDetailsHeader(); }
          showToast(T('khatma_group.toast_member_added', 'تمت إضافة العضو'));
        }
      } catch (e) {
        errEl.textContent = friendlyError(e);
        errEl.classList.remove('hidden');
        openOverlay('#khatma-group-addbyid-overlay');
      }
      btn.disabled = false;
    });

    $('#btn-kg-leave').addEventListener('click', () => {
      $('#kg-details-more-menu').classList.add('hidden');
      if (!confirm(T('khatma_group.confirm_leave', 'هل تريد مغادرة هذه الختمة؟ ستصبح الأجزاء التي حجزتها ولم تقرأها متاحة للآخرين.'))) return;
      leavingGroupId = currentDetailsId;
      leaveGroup(currentDetailsId).then(() => { closeDetails(); showToast(T('khatma_group.toast_left', 'غادرت الختمة')); }).catch((e) => { leavingGroupId = null; showToast(friendlyError(e)); });
    });
    $('#btn-kg-delete').addEventListener('click', () => {
      $('#kg-details-more-menu').classList.add('hidden');
      if (!confirm(T('khatma_group.confirm_delete', 'هل تريد حذف هذه الختمة نهائيًا؟ سيُحذف تقدم جميع الأعضاء.'))) return;
      deleteGroup(currentDetailsId).then(() => { closeDetails(); showToast(T('khatma_group.toast_deleted', 'تم حذف الختمة')); }).catch((e) => showToast(friendlyError(e)));
    });

    // -------- تعديل الختمة: الاسم + الاستمرارية + تاريخ الانتهاء، كلهم مجمّعين هنا --------
    const pad2 = (n) => String(n).padStart(2, '0');
    const dateKey = (dt) => `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
    const parseDateKey = (str) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str || '');
      return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
    };
    const fmtDateLong = (dt) => {
      try {
        const lang = (window.appI18n && window.appI18n.getSavedLang && window.appI18n.getSavedLang()) || 'ar';
        const loc = (lang === 'ar' ? 'ar-EG' : lang) + '-u-ca-gregory';
        return dt.toLocaleDateString(loc, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      } catch (e) { return dateKey(dt); }
    };
    function fillEditDateSelect(currentEndDate) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const cur = parseDateKey(currentEndDate);
      // القايمة بتبدأ من اليوم اللي بعد الموعد الحالي (أو بعد النهارده لو الموعد عدّى/مفيش موعد)
      const base = cur && cur >= today ? cur : today;
      const sel = $('#kg-edit-date-select');
      let html = `<option value="">${escapeHTML(T('khatma_group.no_end_date', 'بدون تاريخ انتهاء'))}</option>`;
      for (let i = 1; i <= 365; i++) {
        const dt = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
        html += `<option value="${dateKey(dt)}">${escapeHTML(fmtDateLong(dt))}</option>`;
      }
      sel.innerHTML = html;
      sel.value = currentEndDate || '';
      const curEl = $('#kg-edit-current-date');
      if (cur) {
        curEl.textContent = `${T('khatma_group.extend_current', 'الموعد الحالي')}: ${fmtDateLong(cur)}`;
        curEl.classList.remove('hidden');
      } else curEl.classList.add('hidden');
    }
    function applyEditContinuousUI(on) {
      const wrap = $('#kg-edit-date-wrap');
      const hint = $('#kg-edit-continuous-hint');
      if (wrap) wrap.classList.toggle('hidden', on);
      if (hint) hint.classList.toggle('hidden', !on);
    }
    const kgEditContToggle = $('#kg-edit-continuous-toggle');
    if (kgEditContToggle) kgEditContToggle.addEventListener('change', () => applyEditContinuousUI(kgEditContToggle.checked));
    $('#btn-kg-edit').addEventListener('click', () => {
      $('#kg-details-more-menu').classList.add('hidden');
      const d = currentDetailsData;
      if (!d) return;
      $('#kg-edit-name').value = d.title || '';
      fillEditDateSelect(d.endDate);
      if (kgEditContToggle) kgEditContToggle.checked = !!d.continuous;
      applyEditContinuousUI(!!d.continuous);
      openOverlay('#khatma-group-edit-overlay');
    });
    $('#btn-kg-edit-cancel').addEventListener('click', () => closeOverlay('#khatma-group-edit-overlay'));
    $('#btn-kg-edit-save').addEventListener('click', async () => {
      const btn = $('#btn-kg-edit-save');
      if (btn.disabled || !currentDetailsId) return;
      const title = $('#kg-edit-name').value.trim();
      if (!title) return;
      const continuous = !!(kgEditContToggle && kgEditContToggle.checked);
      const endDate = continuous ? null : ($('#kg-edit-date-select').value || null);
      btn.disabled = true;
      try {
        const patch = await updateGroupKhatmaSettings(currentDetailsId, { title, continuous, endDate });
        if (currentDetailsData && currentDetailsId) Object.assign(currentDetailsData, patch);
        renderDetailsHeader();
        closeOverlay('#khatma-group-edit-overlay');
        showToast(T('khatma_group.toast_updated', 'تم تحديث بيانات الختمة'));
      } catch (e) { showToast(friendlyError(e), 4000); }
      btn.disabled = false;
    });

    // -------- توزيع الأجزاء --------
    $('#btn-kg-assign').addEventListener('click', openAssignOverlay);
    $('#btn-kg-assign-cta').addEventListener('click', openAssignOverlay);
    $('#btn-kg-assign-close').addEventListener('click', () => closeOverlay('#khatma-group-assign-overlay'));
    $('#kg-assign-members').addEventListener('click', (ev) => {
      const chip = ev.target.closest('[data-uid]');
      if (!chip) return;
      assignSelectedUid = assignSelectedUid === chip.dataset.uid ? null : chip.dataset.uid;
      renderAssignMembers();
      renderAssignGrid();
    });
    $('#kg-assign-grid').addEventListener('click', async (ev) => {
      const cell = ev.target.closest('.kg-unit-cell');
      if (!cell || !currentDetailsData) return;
      if (!assignSelectedUid) { showToast(T('khatma_group.assign_pick_member_first', 'اختر عضوًا من القائمة أولًا')); return; }
      const n = Number(cell.dataset.unit);
      const members = currentDetailsData.members || {};
      const member = { uid: assignSelectedUid, name: (members[assignSelectedUid] && members[assignSelectedUid].name) || '' };
      try { await adminAssignUnit(currentDetailsId, n, member); renderAssignGrid(); }
      catch (e) { showToast(friendlyError(e), 4000); }
    });
    $('#btn-kg-assign-auto').addEventListener('click', async () => {
      const btn = $('#btn-kg-assign-auto');
      btn.disabled = true;
      try {
        await autoDistributeUnits(currentDetailsId);
        showToast(T('khatma_group.toast_assigned', 'تم تقسيم الأجزاء بالتساوي على الأعضاء'));
        renderAssignGrid();
      } catch (e) { showToast(friendlyError(e), 4000); }
      btn.disabled = false;
    });

    // -------- شريط تقدّم قراءة الجزء/الصفحة (شاشة المصحف) --------
    const btnReadingExit = $('#btn-kg-reading-exit');
    if (btnReadingExit) btnReadingExit.addEventListener('click', exitReadingSessionToDetails);
    updateReadingBar(); // لو فيه جلسة قراءة محفوظة من قبل (لسه ما خلصتش)، أظهر الشريط من أول تحميل

    // -------- شاشة الاحتفال --------
    $('#btn-kg-celebrate-close').addEventListener('click', () => closeOverlay('#khatma-group-celebrate-overlay'));
    $('#btn-kg-celebrate-dua').addEventListener('click', () => {
      const box = $('#kg-dua-box');
      box.innerHTML = KHATM_DUA_TEXT;
      box.classList.remove('hidden');
    });

    // -------- اسم القراءة --------
    $('#btn-kg-name-cancel').addEventListener('click', () => closeOverlay('#khatma-name-prompt-overlay'));

    // -------- فتح الختمة مباشرة لو التطبيق اتفتح برابط دعوة --------
    // (1) داخل التطبيق: appUrlOpen من بلجن @capacitor/app، أو الرابط اللي
    //     اتفتح بيه التطبيق أول مرة (getLaunchUrl)، أو النداء المباشر من
    //     MainActivity عبر window.__openKhatmaInviteUrl
    // (2) في متصفح الأندرويد: بنحاول نفتح التطبيق المركّب الأول، ولو ما
    //     اتفتحش بنكمّل بنسخة الويب على نفس الختمة
    const CapApp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (CapApp && CapApp.addListener) {
      CapApp.addListener('appUrlOpen', (data) => { if (data && data.url) window.__openKhatmaInviteUrl(data.url); });
      if (CapApp.getLaunchUrl) {
        CapApp.getLaunchUrl().then((r) => { if (r && r.url) setTimeout(() => window.__openKhatmaInviteUrl(r.url), 300); }).catch(() => {});
      }
    }
    if (window.__pendingInviteUrl) { const u = window.__pendingInviteUrl; window.__pendingInviteUrl = null; setTimeout(() => window.__openKhatmaInviteUrl(u), 300); }

    try {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('khatmaCode');
      if (code) {
        const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
        // ننظّف الرابط عشان الريفرش ما يعيدش الانضمام
        try { window.history.replaceState(window.history.state, '', window.location.pathname + window.location.hash); } catch (e) { /* تجاهل */ }
        const openHere = () => setTimeout(() => openInvitedKhatma(code), 350);
        if (!isNative && /Android/i.test(navigator.userAgent) && !params.get('noapp')) {
          // لو التطبيق مركّب، الأندرويد بيفتحه وصفحة الويب بتتخبّى
          try { window.location.href = `intent://khatmah/join?code=${encodeURIComponent(code)}#Intent;scheme=almushafalashraf;end`; } catch (e) { /* تجاهل */ }
          setTimeout(() => { if (!document.hidden) openHere(); }, 1500);
        } else {
          openHere();
        }
      }
    } catch (e) { /* تجاهل */ }

    // تسخين مبكر للاتصال بـ Firebase (مش إجباري، بس بيقلّل وقت الانتظار
    // أول ما المستخدم يدوس على "ختمة جماعية" فعليًا)
    if (navigator.onLine) initFirebase();
  }

  // تصدير دوال لصفحة "الختمة" الرئيسية في app.js (قسمة فردية/جماعية):
  // فتح تفاصيل ختمة جماعية بعينها، وتحديث قائمة "ختماتي الجماعية" بهدوء
  window.AppBridge.kgOpenDetails = openDetails;
  window.AppBridge.kgOpenHub = () => needsName(() => { openOverlay('#khatma-group-hub-overlay'); refreshHub(); });
  window.AppBridge.kgRefreshHomeGroups = () => { if (navigator.onLine) refreshHub().catch(() => {}); };
  // بتتنادى أول ما app.js يفتح تبويب "الختمة" (شوف switchToTab) — بتفتح
  // شاشة الترحيب (اسم + عرض الـ ID) لو أول مرة فعلًا ولسه معندوش اسم محفوظ
  window.AppBridge.kgMaybeShowOnboarding = () => { if (kgShouldShowOnboarding()) kgOpenOnboarding(); };
  // معرّف المستخدم الحالي (uid) في Firebase — محتاجه app.js عشان يحسب نصيب
  // المستخدم في كارت "ختمتي" بالصفحة الرئيسية (شوف renderKhatmaHomeCard)
  window.AppBridge.kgMyUid = () => myUid;
  // نطاق صفحات وحدة (صفحة/جزء) بعينها في ختمة جماعية — محتاجه app.js عشان
  // يعرض "الخطوة التالية" الفعلية (نطاق الصفحات) لكارت "ختمتي" بالصفحة
  // الرئيسية من غير ما يكرر منطق unitStartPage/unitEndPage
  window.AppBridge.kgUnitPageRange = (unitType, n) => ({ startPage: unitStartPage(unitType, n), endPage: unitEndPage(unitType, n) });
  // بدء جلسة قراءة وحدة بعينها في ختمة جماعية وفتح المصحف عليها مباشرة —
  // نفس الدالة اللي بيستخدمها زرّ "اقرأ الجزء" في تفاصيل الختمة الجماعية،
  // محتاجها كارت "ختمتي" عشان ينفّذ "الخطوة التالية" بضغطة واحدة
  window.AppBridge.kgStartReading = (khatmaId, khatmaTitle, unitType, unit) => startReadingSession(khatmaId, khatmaTitle, unitType, unit);
  // جلسة قراءة الختمة الجماعية الحالية (لو فيه واحدة شغّالة فعلًا، يعني
  // .active صحيح) — محتاجها app.js عشان كبسولة "تقدّم القراءة" العائمة فوق
  // صفحة المصحف (mtt-khatma-pill) تظهر بيانات الختمة الجماعية بدل الفردية
  // لما يكون العضو جوّه جلسة قراءة جماعية شغّالة (شوف updateMttKhatmaPill)
  window.AppBridge.kgGetReadingSession = () => (readingSession && readingSession.active ? readingSession : null);
  // زي اللي فوق بالظبط بس من غير ما يشترط .active — محتاجها أوفرلاي
  // "تقدّم القراءة" المصغّر (mtt-khatma-overlay) عشان يفضل يقدر يورّي بيانات
  // الختمة الجماعية ويتفتح حتى لو المستخدم واقف مؤقتًا فيها (بالظبط زي
  // getOpenSoloKhatma بتاع الختمة الفردية اللي بيتجاهل .active كمان)
  window.AppBridge.kgGetReadingSessionAny = () => readingSession || null;
  // بيبدّل حالة "شغّالة/متوقّفة مؤقتًا" لجلسة القراءة الحالية من غير ما يقفلها
  // أو يتنقّل لأي مكان — بيستخدمه زرّ "إيقاف مؤقت/استئناف" في نفس الأوفرلاي
  window.AppBridge.kgSetReadingSessionActive = (isActive) => {
    if (!readingSession) return;
    readingSession.active = !!isActive;
    saveReadingSession(readingSession);
    updateReadingBar();
  };
  // بيسجّل الوحدة (صفحة/جزء) الحالية "تمّت" على السيرفر مباشرة، وبيقفل جلسة
  // القراءة المحلية لها لو كانت هي نفسها الشغّالة — بيستخدمه زرّ "أتممت
  // التلاوة" في أوفرلاي تقدّم القراءة المصغّر، بدل ما يستنى وصول آخر صفحة
  window.AppBridge.kgCompleteCurrentUnit = async (khatmaId, unit) => {
    const justCompleted = await completeUnit(khatmaId, unit);
    if (readingSession && readingSession.khatmaId === khatmaId && readingSession.unit === unit) {
      readingSession = null;
      saveReadingSession(null);
      updateReadingBar();
    }
    refreshHub().catch(() => {});
    return justCompleted;
  };
  // أقل وحدة تانية لسه متكلة عليّ ولسه ما تمّتش في نفس الختمة، غير الوحدة
  // اللي لسه هتتسجّل تمامها — بيستخدمه زرّ "أتممت التلاوة، ابدأ الورد التالي"
  window.AppBridge.kgFindMyNextUnit = (khatmaId, excludeUnit) => findMyNextUnit(khatmaId, excludeUnit);
  // إيقاف جلسة القراءة الجماعية الحالية "بهدوء" (بدون تنقّل ولا تنبيه) —
  // بتتنادى من app.js لحظة ما المستخدم يفتح ختمة فردية من كارت "ختمتي"
  // بالرئيسية بينما كانت عنده جلسة قراءة جماعية شغّالة، عشان شريط القراءة
  // والكبسولة العائمة يسيبوا الأولوية فورًا للختمة الفردية الجديدة بدل ما
  // يفضلوا واقفين على بيانات الختمة الجماعية القديمة. بتسيب الجلسة نفسها
  // محفوظة (يقدر يكمّلها من نفس الصفحة لو رجعلها) — زي exitReadingSessionToDetails
  // بالظبط بس من غير تنقّل
  window.AppBridge.kgDeactivateReadingSession = () => {
    if (!readingSession || !readingSession.active) return;
    readingSession.active = false;
    saveReadingSession(readingSession);
    updateReadingBar();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
