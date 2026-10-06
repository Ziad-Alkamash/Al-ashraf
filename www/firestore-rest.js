// بديل خفيف لمكتبة Firebase JS SDK (Firestore + Auth)، بيستخدم Firestore
// REST API و Identity Toolkit REST API مباشرة عن طريق fetch() عادي، من غير
// أي WebChannel/streaming — عشان نتفادى مشكلة تعليق الحفظ جوه WebView
// الأندرويد (APK) اللي بتحصل مع الـ SDK الرسمي في بعض الأجهزة/الإصدارات.
//
// بيوفّر نفس القدرات اللي khatma-group.js محتاجها بس بشكل بسيط: هوية
// مجهولة (anonymous auth) محفوظة محليًا وبتتجدد لوحدها، قراءة/إنشاء/تعديل/
// حذف مستند، استعلام بسيط (where)، ومعاملة (transaction) حقيقية للحجز
// الآمن. التحديثات اللحظية (onSnapshot) اتبدّلت بـ polling بسيط (كل شوية
// ثواني) بدل الاعتماد على أي اتصال streaming.
window.FirestoreLite = (() => {
  'use strict';

  const AUTH_KEY = 'almus-hraf:kgAuthRest';
  const FETCH_TIMEOUT_MS = 20000;

  function nowMs() { return Date.now(); }

  function loadAuth() {
    try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (e) { return null; }
  }
  function saveAuth(a) {
    try { localStorage.setItem(AUTH_KEY, JSON.stringify(a)); } catch (e) { /* تجاهل */ }
  }

  function mkErr(message, code) {
    const e = new Error(message || '');
    if (code) e.code = code;
    return e;
  }

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(mkErr('timeout')), ms);
      promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
    });
  }

  class FirestoreClient {
    constructor() {
      this.apiKey = null;
      this.projectId = null;
      this.uid = null;
      this.idToken = null;
      this.refreshToken = null;
      this.expiresAt = 0;
      this._authPromise = null;
    }

    init(config) {
      this.apiKey = config.apiKey;
      this.projectId = config.projectId;
    }

    get docsBase() {
      return `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents`;
    }
    fullName(collection, id) {
      return `projects/${this.projectId}/databases/(default)/documents/${collection}/${id}`;
    }
    idFromName(name) { return String(name || '').split('/').pop(); }

    /* ---------------- fetch أساسي مع مهلة + ترجمة أخطاء ---------------- */
    async _rawFetch(url, opts) {
      if (!navigator.onLine) throw mkErr('offline');
      let res;
      try {
        res = await withTimeout(fetch(url, opts || {}), FETCH_TIMEOUT_MS);
      } catch (e) {
        if (e && e.message === 'timeout') throw e;
        throw mkErr('', 'auth/network-request-failed');
      }
      let body = null;
      try { body = await res.json(); } catch (e) { /* رد فاضي، مقبول لبعض العمليات (زي delete) */ }
      if (!res.ok) {
        const err = (body && body.error) || {};
        const status = String(err.status || '');
        const msg = String(err.message || '');
        if (status === 'NOT_FOUND') throw mkErr('not-found');
        if (status === 'PERMISSION_DENIED') throw mkErr(msg || 'permission-denied', 'permission-denied');
        if (status === 'FAILED_PRECONDITION') throw mkErr(msg || 'failed-precondition', 'failed-precondition');
        if (status === 'UNAVAILABLE') throw mkErr(msg || 'unavailable', 'unavailable');
        if (status === 'ABORTED') throw mkErr(msg || 'aborted', 'aborted');
        if (/API_KEY_INVALID/i.test(msg)) throw mkErr('', 'auth/invalid-api-key');
        if (/REFERER|referer/i.test(msg)) throw mkErr('', 'auth/requests-from-referer-blocked');
        if (/INVALID_ID_TOKEN|TOKEN_EXPIRED|USER_NOT_FOUND|INVALID_REFRESH_TOKEN|USER_DISABLED|MISSING_REFRESH_TOKEN/i.test(msg)) throw mkErr('', 'auth/invalid-user-token');
        // كود/باسورد استرجاع غلط أو حساب مالوش استرجاع مفعّل أصلًا — بنوحّدهم
        // في خطأ واحد مفهوم (recovery-code-invalid) بدل ما نسرّب أي فرق للمستخدم
        // (زي "الحساب مش موجود" مقابل "الباسورد غلط") يفيد حد يحاول يخمّن
        if (/EMAIL_NOT_FOUND|INVALID_PASSWORD|INVALID_LOGIN_CREDENTIALS/i.test(msg)) throw mkErr('recovery-code-invalid');
        if (/OPERATION_NOT_ALLOWED/i.test(msg)) throw mkErr('recovery-not-configured', msg);
        throw mkErr(msg || ('http-' + res.status), status || ('http-' + res.status));
      }
      return body;
    }

    async _authFetch(url, opts) {
      opts = opts || {};
      opts.headers = Object.assign({}, opts.headers, { Authorization: `Bearer ${this.idToken}` });
      return this._rawFetch(url, opts);
    }

    /* ---------------- هوية مجهولة محفوظة محليًا + تجديد تلقائي --------- */
    async ensureAuthed() {
      if (this.idToken && this.expiresAt > nowMs() + 60000) return;
      if (this._authPromise) return this._authPromise;
      this._authPromise = this._doAuth().finally(() => { this._authPromise = null; });
      return this._authPromise;
    }

    async _doAuth() {
      if (!this.apiKey || !this.projectId) throw mkErr('missing-sdk');
      const saved = loadAuth();
      if (saved && saved.refreshToken) {
        try {
          const r = await this._rawFetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(this.apiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(saved.refreshToken)}`
          });
          this.uid = r.user_id; this.idToken = r.id_token; this.refreshToken = r.refresh_token;
          this.expiresAt = nowMs() + Number(r.expires_in || 3600) * 1000;
          saveAuth({ uid: this.uid, refreshToken: this.refreshToken });
          return;
        } catch (e) {
          // نعمل هوية مجهولة جديدة بس لو التوكن اتلغى/اترفض فعليًا من جوجل.
          // أي خطأ تاني (شبكة، timeout، انقطاع، offline...) لازم يرجع لفوق
          // من غير ما نمسح الـ uid المحفوظ، عشان ما نضيع هوية المستخدم
          // (وعضويته في أي ختمة) بسبب مجرد بطء أو انقطاع لحظي في الاتصال.
          if (e && e.code === 'auth/invalid-user-token') {
            // فعلاً باطل/متلغى — منعمل هوية جديدة تحت.
          } else {
            throw e;
          }
        }
      }
      const r2 = await this._rawFetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(this.apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnSecureToken: true })
      });
      this.uid = r2.localId; this.idToken = r2.idToken; this.refreshToken = r2.refreshToken;
      this.expiresAt = nowMs() + Number(r2.expiresIn || 3600) * 1000;
      saveAuth({ uid: this.uid, refreshToken: this.refreshToken });
    }

    /* ---------------- ربط باسورد استرجاع بحسابي المجهول الحالي (يفضل      */
    /* بنفس الـ uid) + تسجيل الدخول بيه من جهاز/تنصيب جديد لاسترجاعه --------- */
    // بتضيف (أو تعدّل لو موجود) بريد/باسورد داخليين لنفس الحساب المجهول
    // الحالي، من غير ما الـ uid يتغيّر خالص — عشان بعدين لو التطبيق اتمسح
    // نقدر "نرجع" لنفس الحساب بمجرد تسجيل دخول عادي بالبريد/الباسورد ده
    async linkPassword(email, password) {
      await this.ensureAuthed();
      const r = await this._rawFetch(`https://identitytoolkit.googleapis.com/v1/accounts:update?key=${encodeURIComponent(this.apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: this.idToken, email, password, returnSecureToken: true })
      });
      // الرد بيرجّع توكنز جديدة لنفس الـ uid بالظبط — نحدّثهم عادي
      if (r.idToken) {
        this.idToken = r.idToken; this.refreshToken = r.refreshToken || this.refreshToken;
        this.expiresAt = nowMs() + Number(r.expiresIn || 3600) * 1000;
        saveAuth({ uid: this.uid, refreshToken: this.refreshToken });
      }
      return true;
    }

    // تسجيل دخول بالبريد/الباسورد الداخليين (مش هوية مجهولة جديدة) — بيرجّع
    // نفس الـ uid القديم بالظبط لو الباسورد صح، وده أساس "استرجاع الختمات
    // الجماعية" بعد مسح التطبيق/بياناته
    async signInWithPassword(email, password) {
      if (!this.apiKey || !this.projectId) throw mkErr('missing-sdk');
      const r = await this._rawFetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(this.apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true })
      });
      this.uid = r.localId; this.idToken = r.idToken; this.refreshToken = r.refreshToken;
      this.expiresAt = nowMs() + Number(r.expiresIn || 3600) * 1000;
      saveAuth({ uid: this.uid, refreshToken: this.refreshToken });
      return { uid: this.uid };
    }

    /* ---------------- تحويل JSON عادي <-> صيغة Firestore REST ---------- */
    toValue(v) {
      if (v === null || v === undefined) return { nullValue: null };
      if (typeof v === 'boolean') return { booleanValue: v };
      if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
      if (typeof v === 'string') return { stringValue: v };
      if (Array.isArray(v)) return { arrayValue: { values: v.map((x) => this.toValue(x)) } };
      if (typeof v === 'object') return { mapValue: { fields: this.toFields(v) } };
      return { stringValue: String(v) };
    }
    toFields(obj) {
      const out = {};
      Object.keys(obj || {}).forEach((k) => { if (obj[k] !== undefined) out[k] = this.toValue(obj[k]); });
      return out;
    }
    fromValue(v) {
      if (!v) return null;
      if ('nullValue' in v) return null;
      if ('booleanValue' in v) return v.booleanValue;
      if ('integerValue' in v) return parseInt(v.integerValue, 10);
      if ('doubleValue' in v) return v.doubleValue;
      if ('stringValue' in v) return v.stringValue;
      if ('timestampValue' in v) return new Date(v.timestampValue).getTime();
      if ('arrayValue' in v) return (v.arrayValue.values || []).map((x) => this.fromValue(x));
      if ('mapValue' in v) return this.fromFields(v.mapValue.fields || {});
      return null;
    }
    fromFields(fields) {
      const out = {};
      Object.keys(fields || {}).forEach((k) => { out[k] = this.fromValue(fields[k]); });
      return out;
    }

    /* ---------------- عمليات CRUD أساسية -------------------------------- */
    async addDoc(collection, data) {
      await this.ensureAuthed();
      const res = await this._authFetch(`${this.docsBase}/${collection}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: this.toFields(data) })
      });
      return { id: this.idFromName(res.name), data };
    }

    async getDoc(collection, id) {
      await this.ensureAuthed();
      try {
        const res = await this._authFetch(`${this.docsBase}/${collection}/${id}`);
        return this.fromFields(res.fields);
      } catch (e) {
        if (e.message === 'not-found') return null;
        throw e;
      }
    }

    async updateDoc(collection, id, patch) {
      await this.ensureAuthed();
      const keys = Object.keys(patch);
      const maskParams = keys.map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
      await this._authFetch(`${this.docsBase}/${collection}/${id}?${maskParams}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: this.toFields(patch) })
      });
    }

    async deleteDoc(collection, id) {
      await this.ensureAuthed();
      await this._authFetch(`${this.docsBase}/${collection}/${id}`, { method: 'DELETE' });
    }

    // filters: [{ field, op: 'EQUAL' | 'ARRAY_CONTAINS', value }]
    async runQuery(collection, filters, limit) {
      await this.ensureAuthed();
      let where;
      if (filters && filters.length === 1) {
        const f = filters[0];
        where = { fieldFilter: { field: { fieldPath: f.field }, op: f.op, value: this.toValue(f.value) } };
      } else if (filters && filters.length > 1) {
        where = { compositeFilter: { op: 'AND', filters: filters.map((f) => ({ fieldFilter: { field: { fieldPath: f.field }, op: f.op, value: this.toValue(f.value) } })) } };
      }
      const structuredQuery = { from: [{ collectionId: collection }] };
      if (where) structuredQuery.where = where;
      if (limit) structuredQuery.limit = limit;
      const res = await this._authFetch(`${this.docsBase}:runQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery })
      });
      return (Array.isArray(res) ? res : []).filter((r) => r.document)
        .map((r) => ({ id: this.idFromName(r.document.name), data: this.fromFields(r.document.fields) }));
    }

    /* ---------------- "قراءة + تعديل بشرط" (compare-and-swap) بدل الـ  */
    /* transaction الحقيقية — لتفادي beginTransaction اللي مرفوض من قواعد */
    /* الأمان (مفيش allow على جذر /databases/{database}/documents/ نفسه، */
    /* وقواعدنا كلها متعرّفة جوه match /khatmaGroups/{khatmaId} بس).      */
    /* الفكرة: نقرأ المستند عادي، نحسب التعديل، ونكتبه بـ PATCH عادي مع   */
    /* شرط currentDocument.updateTime = نفس وقت التعديل اللي قرأناه —    */
    /* فلو حد غيّر المستند فعلاً في نفس اللحظة (نفس الحجز)، الكتابة ترفض */
    /* بـ FAILED_PRECONDITION تلقائيًا، وبنعيد قراءة/حساب/كتابة من الأول */
    /* — نفس ضمان منع تعارض الحجز، من غير الحاجة لـ beginTransaction/commit */
    // updater(currentDataOrNull) لازم يرجّع:
    //   - null/undefined: مفيش تعديل مطلوب (خلاص، مفيش كتابة)
    //   - { patch, result }: التعديل المطلوب + القيمة اللي runTransaction هيرجّعها
    // لو رمى updater استثناء (خطأ منطق زي 'taken'/'not-found') بيتلغى فورًا
    // من غير إعادة محاولة. إعادة المحاولة بتحصل بس لو فيه تعارض حقيقي وقت
    // الكتابة (FAILED_PRECONDITION بسبب تغيّر updateTime) — لحد ٥ مرات
    async runTransaction(collection, id, updater) {
      await this.ensureAuthed();
      const MAX = 5;
      let lastErr;
      for (let i = 0; i < MAX; i++) {
        let data, updateTime;
        try {
          const getRes = await this._authFetch(`${this.docsBase}/${collection}/${id}`);
          data = this.fromFields(getRes.fields);
          updateTime = getRes.updateTime;
        } catch (e) {
          if (e.message === 'not-found') { data = null; updateTime = null; }
          else { e.message = 'read[' + (e.code || '') + ']: ' + (e.message || ''); throw e; }
        }

        const outcome = await updater(data);

        if (!outcome || !outcome.patch) {
          return outcome ? outcome.result : undefined;
        }

        try {
          const keys = Object.keys(outcome.patch);
          const maskParams = keys.map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
          const precondition = updateTime
            ? `currentDocument.updateTime=${encodeURIComponent(updateTime)}`
            : `currentDocument.exists=false`;
          await this._authFetch(`${this.docsBase}/${collection}/${id}?${maskParams}&${precondition}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fields: this.toFields(outcome.patch) })
          });
          return outcome.result;
        } catch (e) {
          lastErr = e;
          if (e.code === 'failed-precondition' && i < MAX - 1) continue;
          e.message = 'write[' + (e.code || '') + ']: ' + (e.message || '');
          throw e;
        }
      }
      throw lastErr || mkErr('timeout');
    }
  }

  return new FirestoreClient();
})();
