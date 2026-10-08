// المصحف الأشرف — طبقة الاتصال بمصادر بيانات القرآن الكريم (نظام صفحات مصحف المدينة)
// المصدر الرئيسي: alquran.cloud (نص مصحف حفص، تفسير الميسر، صوت الشيخ العفاسي)
// المصدر الثانوي لمعاني الكلمات: quran.com API v4
const QuranAPI = (() => {
  const BASE = 'https://api.alquran.cloud/v1';
  const QCOM = 'https://api.quran.com/api/v4';
  const CACHE_PREFIX = 'almus-hraf-cache:';
  // نفس اسم كاش Cache Storage المُستخدَم في sw.js (API_CACHE_NAME) — بنفتحه هنا
  // مباشرة من الصفحة عشان نتحقق فعليًا إن كل سورة تفسير اتخزنت بنجاح أثناء
  // "تحميل إصدار تفسير كامل"، بدل الاعتماد فقط على نجاح fetch() اللي ممكن
  // ينجح مع الشبكة لكن يفشل التخزين نفسه بصمت (مساحة ممتلئة مثلًا) فيوهم
  // المستخدم إن التحميل اكتمل وهو فعليًا ناقص (تحميل "وهمي")
  const TAFSIR_API_CACHE_NAME = 'mushaf-ashraf-quran-data-v1';

  // تنظيف مرة واحدة (رخيص جدًا لو مفيش حاجة تُمسح): إفراغ كاش استجابات
  // الشبكة القديم اللي كان متخزَّن في localStorage قبل النقل لـ IndexedDB،
  // عشان نرجّع المساحة فورًا للمستخدمين الحاليين. بنستهدف بس المفاتيح اللي
  // بادئتها الثانية "http" أو "search:" (روابط/بحث فعلي)، وسايبين فهرس
  // صفحات السور وفهرس التحميل زي ما هما لأنهم صغار وعمرهم لسه في localStorage
  if (typeof IdbKVCache !== 'undefined') {
    IdbKVCache.purgeLegacyLocalStorageKeys([CACHE_PREFIX + 'http', CACHE_PREFIX + 'search:']);
  }

  // فهرس دائم (سورة → رقم الصفحة) يُبنى تلقائيًا محليًا كلما عُرضت صفحة
  // (سواء من الشبكة أو من الكاش)، ويُستخدم أيضًا أثناء "تحميل كل الصفحات".
  // بهذا يعمل الانتقال المباشر لأي سورة فورًا وبدون إنترنت بمجرد أن تكون
  // صفحتها قد مرّت مرة واحدة على الجهاز، دون أي اعتماد على نقطة اتصال أخرى
  // قد لا تكون مخزَّنة (مثل نقطة /surah/{n} التي لا يخزّنها زر التحميل الشامل).
  const SURAH_PAGE_MAP_KEY = CACHE_PREFIX + 'surahPageMap';

  function loadSurahPageMap() {
    try {
      const raw = localStorage.getItem(SURAH_PAGE_MAP_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveSurahStartPage(surahNumber, pageNumber) {
    try {
      const map = loadSurahPageMap();
      if (map[surahNumber] !== pageNumber) {
        map[surahNumber] = pageNumber;
        localStorage.setItem(SURAH_PAGE_MAP_KEY, JSON.stringify(map));
      }
    } catch (e) { /* عند امتلاء الذاكرة */ }
  }

  // يفحص بيانات صفحة خام (كما ترجع من نقطة page/{n}) ويسجّل بداية أي سورة
  // تبدأ في هذه الصفحة. تُستخدم من getPage تلقائيًا، ومن أداة التحميل الشامل
  // في app.js حتى يكتمل الفهرس بمجرد تحميل كل الصفحات ولو مرة واحدة.
  function recordSurahStartPagesFromRawPage(rawData) {
    try {
      const ayahs = rawData && rawData.data && rawData.data.ayahs;
      if (!ayahs) return;
      ayahs.forEach((a) => {
        if (a.numberInSurah === 1) {
          saveSurahStartPage(a.surah.number, a.page);
        }
      });
    } catch (e) { /* تجاهل أي بيانات غير متوقعة */ }
  }

  // دالة جلب مع التخزين المحلي (Cache) لتسريع التحميل وتوفير الترافيك.
  // كانت مخزَّنة في localStorage قبل كده، لكن مع تراكم صفحات/آيات/تفاسير
  // كتيرة بمرور وقت الاستخدام العادي كانت بتوصل لحد مساحته (٥-١٠ ميجا) فتفشل
  // كتابات لاحقة بصمت — مش بس هنا، لكن في إعدادات تانية غير مرتبطة أصلًا
  // (زي القارئ الافتراضي وقايمة السور المحمّلة) لأنهم بيشاركوا نفس المساحة
  // المحدودة. النقل لـ IndexedDB (مساحته أكبر بمراحل، ونفس async بطبيعته)
  // بيحل المشكلة من جذرها بدون أي تعديل في نقاط استخدام الدالة دي
  // مهلة صريحة (١٢ ثانية) + محاولتين: على شبكة بطيئة/متقطعة كان الطلب بيفضل
  // معلّق بلا حد أقصى فتقف الشاشة كلها (زي "جارٍ تجهيز الآيات" في التسميع).
  // ولو الطلب فشل وعندنا نسخة قديمة منتهية الصلاحية في الكاش نرجّعها بدل الفشل
  async function cachedFetchJSON(url, ttlHours = 24 * 30, opts) {
    const cached = await IdbKVCache.get('quran-api', url);
    if (cached && Date.now() - cached.t < ttlHours * 3600 * 1000) {
      return cached.v;
    }

    const timeoutMs = (opts && opts.timeoutMs) || 12000;
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error('تعذر الاتصال بالخادم: ' + res.status);
        const data = await res.json();
        try { await IdbKVCache.set('quran-api', url, data); } catch (e) { /* تجاهل فشل التخزين */ }
        return data;
      } catch (e) {
        lastErr = e;
      } finally {
        clearTimeout(timer);
      }
    }
    if (cached && cached.v) return cached.v;
    throw lastErr;
  }

  // رابط جلب صفحة خام (بدون تخزين محلي) — تستخدمه أداة التحميل الكامل للعمل بدون إنترنت
  // (تفتح الرابط عبر fetch مباشرة ليعترضها Service Worker ويخزّنها في ذاكرته الدائمة)
  function pageURL(pageNumber) {
    return `${BASE}/page/${pageNumber}/quran-uthmani`;
  }

  // 1️⃣ جلب بيانات صفحة محددة من صفحات المصحف الـ 604
  // أولوية القراءة: التخزين المحلي عبر Capacitor Filesystem (QuranOffline،
  // شغّال فقط داخل تطبيق أندرويد/آيفون المثبَّت بعد تحميل الصفحات مرة واحدة)
  // ← فالكاش المؤقت بالمتصفح (localStorage) ← فالشبكة كحل أخير
  async function getPage(pageNumber) {
    if (pageNumber < 1 || pageNumber > 604) throw new Error('رقم الصفحة يجب أن يكون بين 1 و 604');

    let data = null;
    // Every standard Mushaf page ships with the app so first launch and
    // rapid flips never wait for the Quran text API or a background download.
    try {
      const paddedPage = String(pageNumber).padStart(3, '0');
      const bundledUrl = new URL(`quran-data/page-text/page-${paddedPage}.json`, document.baseURI);
      const response = await fetch(bundledUrl);
      if (response.ok) data = await response.json();
    } catch (e) { /* older web deployments fall back to the existing cache/API */ }
    if (window.QuranOffline && window.QuranOffline.isNativeReady && window.QuranOffline.isNativeReady()) {
      if (!data) data = await window.QuranOffline.readPage(pageNumber).catch(() => null);
    }
    if (!data) {
      data = await cachedFetchJSON(`${BASE}/page/${pageNumber}/quran-uthmani`);
    }
    const rawAyahs = data.data.ayahs;

    if (!rawAyahs || rawAyahs.length === 0) throw new Error('لا توجد بيانات لهذه الصفحة');

    // كل مرة تُعرض فيها صفحة (من الشبكة أو من الكاش) نُحدّث فهرس بدايات
    // السور محليًا، حتى يعمل الانتقال المباشر لأي سورة بدون إنترنت لاحقًا
    recordSurahStartPagesFromRawPage(data);

    // استخراج معلومات الهيدر العلوي للصفحة (اسم السورة الرئيسية، الجزء، الصفحة)
    const primarySurah = rawAyahs[0].surah;
    const juz = rawAyahs[0].juz;
    const page = pageNumber;

    // معالجة الآيات وتنظيم ترويسات السور والبسملة
    const ayahs = rawAyahs.map((a) => {
      let cleanText = a.text;
      const isFirstAyahInSurah = a.numberInSurah === 1;

      // إزالة البسملة المدمجة في نص أول آية (باستثناء الفاتحة والتوبة) لتعرض في تصميم منفصل
      if (isFirstAyahInSurah && a.surah.number !== 1 && a.surah.number !== 9) {
        cleanText = cleanText.replace(/^بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ\s*/, '');
      }

      return {
        number: a.number,                   // الرقم العام للآية في المصحف
        numberInSurah: a.numberInSurah,     // رقم الآية داخل السورة
        text: cleanText,                    // النص العثماني النظيف
        surah: {
          number: a.surah.number,
          nameAr: a.surah.name,
          englishName: a.surah.englishName,
          revelationType: a.surah.revelationType === 'Meccan' ? 'مكية' : 'مدنية',
          numberOfAyahs: a.surah.numberOfAyahs
        },
        juz: a.juz,
        manzil: a.manzil,
        page: a.page,
        ruku: a.ruku,
        hizbQuarter: a.hizbQuarter,
        sajda: a.sajda || false,
        isSurahStart: isFirstAyahInSurah     // هل تبدأ سورة جديدة عند هذه الآية
      };
    });

    return {
      pageNumber: page,
      juzNumber: juz,
      headerSurahName: primarySurah.name,
      headerSurahNumber: primarySurah.number,
      ayahs: ayahs
    };
  }

  // 2️⃣ قائمة السور الـ 114 للبحث والانتقال السريع (مع رقم صفحة بداية كل سورة)
  // ===== بيانات ثابتة داخل التطبيق: فهرس السور الـ ١١٤ =====
  // أسماء السور وعدد آياتها ومكان نزولها وصفحة بداية كل سورة في مصحف المدينة
  // بيانات ثابتة لا تتغير أبدًا، فمفيش أي داعي نجيبها من الإنترنت. كانت
  // getSurahList بتجيبها من نقطة /meta في alquran.cloud وتخزّنها في localStorage
  // لمدة ٣٠ يوم، فلو التطبيق اتفتح لأول مرة بدون إنترنت، أو الكاش انتهى/اتمسح،
  // كان فهرس السور بيفضل فاضي مع رسالة "تعذر تحميل فهرس السور". دلوقتي بتتقرأ
  // من هنا مباشرة فيشتغل الفهرس فورًا وبدون أي اتصال
  // كل صف: [الاسم العربي، الاسم اللاتيني (للبحث)، عدد الآيات، 'M' مكية | 'D' مدنية]
  const SURAH_META = [
    ["الفاتحة", "Al-Fatihah", 7, 'M'],
    ["البقرة", "Al-Baqarah", 286, 'D'],
    ["آل عمران", "Ali 'Imran", 200, 'D'],
    ["النساء", "An-Nisa", 176, 'D'],
    ["المائدة", "Al-Ma'idah", 120, 'D'],
    ["الأنعام", "Al-An'am", 165, 'M'],
    ["الأعراف", "Al-A'raf", 206, 'M'],
    ["الأنفال", "Al-Anfal", 75, 'D'],
    ["التوبة", "At-Tawbah", 129, 'D'],
    ["يونس", "Yunus", 109, 'M'],
    ["هود", "Hud", 123, 'M'],
    ["يوسف", "Yusuf", 111, 'M'],
    ["الرعد", "Ar-Ra'd", 43, 'D'],
    ["إبراهيم", "Ibrahim", 52, 'M'],
    ["الحجر", "Al-Hijr", 99, 'M'],
    ["النحل", "An-Nahl", 128, 'M'],
    ["الإسراء", "Al-Isra", 111, 'M'],
    ["الكهف", "Al-Kahf", 110, 'M'],
    ["مريم", "Maryam", 98, 'M'],
    ["طه", "Taha", 135, 'M'],
    ["الأنبياء", "Al-Anbya", 112, 'M'],
    ["الحج", "Al-Hajj", 78, 'D'],
    ["المؤمنون", "Al-Mu'minun", 118, 'M'],
    ["النور", "An-Nur", 64, 'D'],
    ["الفرقان", "Al-Furqan", 77, 'M'],
    ["الشعراء", "Ash-Shu'ara", 227, 'M'],
    ["النمل", "An-Naml", 93, 'M'],
    ["القصص", "Al-Qasas", 88, 'M'],
    ["العنكبوت", "Al-'Ankabut", 69, 'M'],
    ["الروم", "Ar-Rum", 60, 'M'],
    ["لقمان", "Luqman", 34, 'M'],
    ["السجدة", "As-Sajdah", 30, 'M'],
    ["الأحزاب", "Al-Ahzab", 73, 'D'],
    ["سبإ", "Saba", 54, 'M'],
    ["فاطر", "Fatir", 45, 'M'],
    ["يس", "Ya-Sin", 83, 'M'],
    ["الصافات", "As-Saffat", 182, 'M'],
    ["ص", "Sad", 88, 'M'],
    ["الزمر", "Az-Zumar", 75, 'M'],
    ["غافر", "Ghafir", 85, 'M'],
    ["فصلت", "Fussilat", 54, 'M'],
    ["الشورى", "Ash-Shuraa", 53, 'M'],
    ["الزخرف", "Az-Zukhruf", 89, 'M'],
    ["الدخان", "Ad-Dukhan", 59, 'M'],
    ["الجاثية", "Al-Jathiyah", 37, 'M'],
    ["الأحقاف", "Al-Ahqaf", 35, 'M'],
    ["محمد", "Muhammad", 38, 'D'],
    ["الفتح", "Al-Fath", 29, 'D'],
    ["الحجرات", "Al-Hujurat", 18, 'D'],
    ["ق", "Qaf", 45, 'M'],
    ["الذاريات", "Adh-Dhariyat", 60, 'M'],
    ["الطور", "At-Tur", 49, 'M'],
    ["النجم", "An-Najm", 62, 'M'],
    ["القمر", "Al-Qamar", 55, 'M'],
    ["الرحمن", "Ar-Rahman", 78, 'D'],
    ["الواقعة", "Al-Waqi'ah", 96, 'M'],
    ["الحديد", "Al-Hadid", 29, 'D'],
    ["المجادلة", "Al-Mujadila", 22, 'D'],
    ["الحشر", "Al-Hashr", 24, 'D'],
    ["الممتحنة", "Al-Mumtahanah", 13, 'D'],
    ["الصف", "As-Saf", 14, 'D'],
    ["الجمعة", "Al-Jumu'ah", 11, 'D'],
    ["المنافقون", "Al-Munafiqun", 11, 'D'],
    ["التغابن", "At-Taghabun", 18, 'D'],
    ["الطلاق", "At-Talaq", 12, 'D'],
    ["التحريم", "At-Tahrim", 12, 'D'],
    ["الملك", "Al-Mulk", 30, 'M'],
    ["القلم", "Al-Qalam", 52, 'M'],
    ["الحاقة", "Al-Haqqah", 52, 'M'],
    ["المعارج", "Al-Ma'arij", 44, 'M'],
    ["نوح", "Nuh", 28, 'M'],
    ["الجن", "Al-Jinn", 28, 'M'],
    ["المزمل", "Al-Muzzammil", 20, 'M'],
    ["المدثر", "Al-Muddaththir", 56, 'M'],
    ["القيامة", "Al-Qiyamah", 40, 'M'],
    ["الإنسان", "Al-Insan", 31, 'D'],
    ["المرسلات", "Al-Mursalat", 50, 'M'],
    ["النبإ", "An-Naba", 40, 'M'],
    ["النازعات", "An-Nazi'at", 46, 'M'],
    ["عبس", "'Abasa", 42, 'M'],
    ["التكوير", "At-Takwir", 29, 'M'],
    ["الإنفطار", "Al-Infitar", 19, 'M'],
    ["المطففين", "Al-Mutaffifin", 36, 'M'],
    ["الإنشقاق", "Al-Inshiqaq", 25, 'M'],
    ["البروج", "Al-Buruj", 22, 'M'],
    ["الطارق", "At-Tariq", 17, 'M'],
    ["الأعلى", "Al-A'la", 19, 'M'],
    ["الغاشية", "Al-Ghashiyah", 26, 'M'],
    ["الفجر", "Al-Fajr", 30, 'M'],
    ["البلد", "Al-Balad", 20, 'M'],
    ["الشمس", "Ash-Shams", 15, 'M'],
    ["الليل", "Al-Layl", 21, 'M'],
    ["الضحى", "Ad-Duhaa", 11, 'M'],
    ["الشرح", "Ash-Sharh", 8, 'M'],
    ["التين", "At-Tin", 8, 'M'],
    ["العلق", "Al-'Alaq", 19, 'M'],
    ["القدر", "Al-Qadr", 5, 'M'],
    ["البينة", "Al-Bayyinah", 8, 'D'],
    ["الزلزلة", "Az-Zalzalah", 8, 'D'],
    ["العاديات", "Al-'Adiyat", 11, 'M'],
    ["القارعة", "Al-Qari'ah", 11, 'M'],
    ["التكاثر", "At-Takathur", 8, 'M'],
    ["العصر", "Al-'Asr", 3, 'M'],
    ["الهمزة", "Al-Humazah", 9, 'M'],
    ["الفيل", "Al-Fil", 5, 'M'],
    ["قريش", "Quraysh", 4, 'M'],
    ["الماعون", "Al-Ma'un", 7, 'M'],
    ["الكوثر", "Al-Kawthar", 3, 'M'],
    ["الكافرون", "Al-Kafirun", 6, 'M'],
    ["النصر", "An-Nasr", 3, 'D'],
    ["المسد", "Al-Masad", 5, 'M'],
    ["الإخلاص", "Al-Ikhlas", 4, 'M'],
    ["الفلق", "Al-Falaq", 5, 'M'],
    ["الناس", "An-Nas", 6, 'M']
  ];

  // رقم صفحة بداية كل سورة (مصحف المدينة ٦٠٤ صفحة) — نفس جدول SURAH_START_PAGES في app.js
  const SURAH_START_PAGES_STATIC = [
    1, 2, 50, 77, 106, 128, 151, 177, 187, 208,
    221, 235, 249, 255, 262, 267, 282, 293, 305, 312,
    322, 332, 342, 350, 359, 367, 377, 385, 396, 404,
    411, 415, 418, 428, 434, 440, 446, 453, 458, 467,
    477, 483, 489, 496, 499, 502, 507, 511, 515, 518,
    520, 523, 526, 528, 531, 534, 537, 542, 545, 549,
    551, 553, 554, 556, 558, 560, 562, 564, 566, 568,
    570, 572, 574, 575, 577, 578, 580, 582, 583, 585,
    586, 587, 587, 589, 590, 591, 591, 592, 593, 594,
    595, 595, 596, 596, 597, 597, 598, 598, 599, 599,
    600, 600, 601, 601, 601, 602, 602, 602, 603, 603,
    603, 604, 604, 604
  ];

  async function getSurahList() {
    return SURAH_META.map((r, i) => ({
      number: i + 1,
      nameAr: 'سُورَةُ ' + r[0],
      nameEn: r[1],
      nameTranslation: '',
      ayahCount: r[2],
      revelationType: r[3] === 'M' ? 'مكية' : 'مدنية'
    }));
  }

  // 2️⃣.٥ فهرس أرباع الأحزاب الـ 240 (لتبويب "فهرس الأجزاء" التفصيلي)
  // يُحسب مرة واحدة ثم يُخزَّن دائمًا محليًا، فيعمل فتح الفهرس بعدها فورًا
  // وبدون إنترنت. كل عنصر يمثّل بداية ربع حزب جديد:
  // { quarterNumber (1-240), hizbNumber (1-60), quarterInHizb (1-4), page,
  //   surahNumber, surahNameAr, numberInSurah, text (نص أول آية في الربع) }
  //
  // ملاحظة مهمة (سبب إعادة الكتابة): النسخة القديمة كانت تجلب نص المصحف
  // بالكامل دفعة واحدة من نقطة /quran/quran-uthmani — طلب شبكة ضخم واحد لا
  // علاقة له بأي كاش موجود بالفعل على الجهاز، فكان يفشل غالبًا مع أي ضعف
  // في الاتصال، وحتى لو المستخدم كان قد حمّل المصحف كاملًا من قبل عبر زر
  // "تحميل كل الصفحات" في الإعدادات، هذا التحميل ما كانش يفيد فهرس الأجزاء
  // في شيء لأنه طلب مستقل تمامًا وغير مغطّى به. النسخة الحالية تبني الفهرس
  // من نفس نقطة الصفحات (page/{n}) المستخدمة في القراءة العادية عبر getPage،
  // وهي نفسها اللي يخزّنها الـ Service Worker بشكل دائم مع كل صفحة تُفتح أو
  // تُحمَّل بزر "تحميل كل الصفحات" — فتعمل عندها فتح الفهرس فورًا وبدون
  // إنترنت تمامًا زي فهرس السور (بل أفضل: لو المصحف اتحمّل كاملًا من قبل،
  // ما فيش أي طلب شبكة إضافي على الإطلاق حتى لأول مرة تُفتح فيها)
  const HIZB_QUARTER_INDEX_KEY = CACHE_PREFIX + 'hizbQuarterIndex';

  // جلب صفحة مع محاولات إعادة قبل الاستسلام — الصفحة الواحدة قد تفشل لحظيًا
  // (تذبذب شبكة، أو رفض مؤقت من الخادم بسبب كثرة الطلبات) دون أن يعني هذا
  // فعلًا انعدام الإنترنت، فإعادة المحاولة هنا تمنع فشل الفهرس بالكامل بسبب
  // صفحة واحدة عابرة طالما الاتصال شغّال فعلًا
  async function getPageWithRetry(pageNumber, retries = 2) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await getPage(pageNumber);
      } catch (e) {
        lastErr = e;
        if (attempt < retries) await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  async function getHizbQuarterIndex() {
    try {
      const raw = localStorage.getItem(HIZB_QUARTER_INDEX_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length === 240) return parsed;
      }
    } catch (e) { /* تجاهل، سيُعاد البناء */ }

    // تزامن أقل من قبل (كان 12) لتقليل احتمال رفض الخادم للطلبات الكثيرة
    // دفعة واحدة، فضلًا عن إعادة المحاولة أعلى في getPageWithRetry — أي صفحة
    // مخزَّنة بالفعل (من القراءة العادية أو التحميل الشامل) ترجع فورًا من
    // كاش الـ Service Worker بدون أي طلب شبكة حقيقي
    const CONCURRENCY = 6;
    const rawAyahs = [];
    let nextPage = 1;
    let hardError = null;

    async function worker() {
      while (nextPage <= 604 && !hardError) {
        const p = nextPage++;
        try {
          const data = await getPageWithRetry(p);
          data.ayahs.forEach((a) => {
            rawAyahs.push({
              page: data.pageNumber,
              hizbQuarter: a.hizbQuarter,
              surahNumber: a.surah.number,
              surahNameAr: a.surah.nameAr,
              numberInSurah: a.numberInSurah,
              text: a.text // نص نظيف بالفعل (البسملة مُزالة من داخل getPage)
            });
          });
        } catch (e) {
          hardError = e;
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (hardError) throw hardError;

    // الصفحات وصلت بالتوازي فترتيبها في المصفوفة غير مضمون؛ نعيد ترتيبها
    // حسب رقم الصفحة ثم موقع الآية داخلها (وهو ترتيب صحيح داخل كل صفحة
    // أصلًا) قبل استخراج بدايات كل ربع حزب جديد
    rawAyahs.sort((a, b) => (a.page - b.page) || (a.surahNumber - b.surahNumber) || (a.numberInSurah - b.numberInSurah));

    const list = [];
    let lastQuarter = 0;
    rawAyahs.forEach((a) => {
      if (a.hizbQuarter !== lastQuarter) {
        lastQuarter = a.hizbQuarter;
        list.push({
          quarterNumber: a.hizbQuarter,
          hizbNumber: Math.ceil(a.hizbQuarter / 4),
          quarterInHizb: ((a.hizbQuarter - 1) % 4) + 1,
          page: a.page,
          surahNumber: a.surahNumber,
          surahNameAr: a.surahNameAr,
          numberInSurah: a.numberInSurah,
          text: a.text
        });
      }
    });

    if (list.length !== 240) throw new Error('تعذر بناء فهرس الأجزاء كاملاً (بيانات ناقصة)');

    try { localStorage.setItem(HIZB_QUARTER_INDEX_KEY, JSON.stringify(list)); } catch (e) { /* تجاهل */ }
    return list;
  }

  // 3️⃣ معرفة رقم الصفحة التي تبدأ عندها سورة معينة
  // أولوية القراءة من الفهرس المحلي الدائم (يعمل فورًا وبدون إنترنت إن كانت
  // صفحة هذه السورة قد مرّت على الجهاز من قبل، سواء بالتصفح أو بالتحميل
  // الشامل)، فإن لم توجد نلجأ للشبكة كحل احتياطي ونضيف النتيجة للفهرس.
  async function getSurahStartPage(surahNumber) {
    const map = loadSurahPageMap();
    if (map[surahNumber]) return map[surahNumber];

    // جدول ثابت داخل التطبيق: الانتقال لأي سورة يشتغل فورًا وبدون إنترنت حتى لو
    // صفحتها ما اتفتحتش قبل كده (كان بيفشل بـ"هذه السورة لم تُفتح من قبل")
    const staticPage = SURAH_START_PAGES_STATIC[Number(surahNumber) - 1];
    if (staticPage) return staticPage;

    const data = await cachedFetchJSON(`${BASE}/surah/${surahNumber}/quran-uthmani`);
    if (data.data && data.data.ayahs && data.data.ayahs.length > 0) {
      const page = data.data.ayahs[0].page;
      saveSurahStartPage(surahNumber, page);
      return page;
    }
    return 1;
  }

  // 3️⃣.٥ نص نطاق من الآيات (من آية إلى آية) داخل سورة معينة — لمشاركة عدة آيات كصورة واحدة.
  // تُبنى من نقطة "page" نفسها المستخدمة في القراءة العادية وفي "تحميل كل الصفحات"،
  // فتعمل بدون إنترنت طالما أن صفحات هذه السورة سبق أن مرّت على الجهاز (بالتصفح أو بالتحميل الشامل)
  async function getAyahRange(surahNumber, fromAyah, toAyah) {
    const needed = toAyah - fromAyah + 1;
    let page = await getSurahStartPage(surahNumber);
    const collected = [];
    let guard = 0;

    while (collected.length < needed && page <= 604 && guard < 40) {
      let data;
      try {
        data = await getPageWithRetry(page, 1);
      } catch (e) {
        break;
      }
      let passedSurah = false;
      data.ayahs.forEach((a) => {
        if (a.surah.number === surahNumber && a.numberInSurah >= fromAyah && a.numberInSurah <= toAyah) {
          collected.push({ numberInSurah: a.numberInSurah, text: a.text, page: data.pageNumber });
        }
        if (a.surah.number > surahNumber) passedSurah = true;
      });
      if (passedSurah && collected.length < needed) break;
      page += 1;
      guard += 1;
    }

    collected.sort((a, b) => a.numberInSurah - b.numberInSurah);
    return collected;
  }

  // 3️⃣.٦ رقم الصفحة التي تقع فيها آية معينة بالضبط (تُستخدم لتتبّع القراءة تلقائيًا
  // أثناء الاستماع المتواصل، حتى تنتقل صفحة المصحف مع القارئ لو الآية طلعت بره
  // الصفحة المعروضة حاليًا). نتيجة alquran.cloud لآية مفردة تتضمن رقم صفحتها مباشرة
  // بحث ثنائي محلي عن صفحة الآية بين صفحة بداية السورة وصفحة بداية السورة التالية
  // (جدول ثابت) باستخدام getPage — بيشتغل من الملفات المحمّلة/الكاش وبدون نقطة
  // /ayah اللي كانت السبب في تعليق التسميع وتشغيل الصوت على النت البطيء
  async function findAyahPageLocally(surahNumber, ayahNumber) {
    const start = SURAH_START_PAGES_STATIC[surahNumber - 1];
    if (!start) return null;
    const end = SURAH_START_PAGES_STATIC[surahNumber] || 604;
    const target = surahNumber * 1000 + ayahNumber;
    let lo = start, hi = end;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const data = await getPage(mid);
      const first = data.ayahs[0];
      const last = data.ayahs[data.ayahs.length - 1];
      const fk = first.surah.number * 1000 + first.numberInSurah;
      const lk = last.surah.number * 1000 + last.numberInSurah;
      if (target < fk) hi = mid - 1;
      else if (target > lk) lo = mid + 1;
      else return mid;
    }
    return null;
  }

  let bundledQcfAyahPagesPromise = null;
  async function getBundledQcfAyahPages() {
    if (!bundledQcfAyahPagesPromise) {
      bundledQcfAyahPagesPromise = (async () => {
        try {
          const url = new URL('quran-data/qcf4/ayah-pages.json', document.baseURI);
          const response = await fetch(url);
          if (response.ok) return await response.json();
        } catch (_) { /* إصدارات الويب القديمة تستخدم الفهرس الاحتياطي */ }
        return null;
      })();
    }
    return bundledQcfAyahPagesPromise;
  }

  async function getAyahPage(surahNumber, ayahNumber) {
    // Hafs is rendered from bundled QCF4 pages. Prefer their verse index so
    // audio follow and direct verse navigation land on the page the user sees;
    // the generic text API has different page breaks for some boundary ayahs.
    let edition = 'hafs';
    try { edition = localStorage.getItem('mushaf-edition') || 'hafs'; } catch (_) { /* default to Hafs */ }
    if (edition === 'hafs') {
      try {
        const pages = await getBundledQcfAyahPages();
        const page = Number(pages && pages[`${Number(surahNumber)}:${Number(ayahNumber)}`]);
        if (page >= 1 && page <= 604) return page;
      } catch (_) { /* use existing local/API lookup below */ }
    }

    const nativeReady = !!(window.QuranOffline && window.QuranOffline.isNativeReady && window.QuranOffline.isNativeReady());
    if (nativeReady) {
      try {
        const p = await findAyahPageLocally(surahNumber, ayahNumber);
        if (p) return p;
      } catch (e) { /* نكمّل للشبكة */ }
    }
    try {
      const data = await cachedFetchJSON(`${BASE}/ayah/${surahNumber}:${ayahNumber}/quran-uthmani`, 24 * 365, { timeoutMs: 8000 });
      const p = data.data && data.data.page;
      if (p) return p;
    } catch (e) { /* نجرّب البحث المحلي */ }
    return findAyahPageLocally(surahNumber, ayahNumber);
  }

  // 3️⃣.٧ قائمة آيات سورة معينة مع طول نص كل آية (بالحروف) — تُستخدم لتقدير توقيت
  // كل آية تقريبيًا داخل ملف صوتي لسورة كاملة عند القراء اللي مفيش عندهم توقيت
  // آية-بآية حقيقي (انظر isCustomAudioReciter). نفس نقطة الاتصال المستخدمة أصلاً
  // في getSurahStartPage، فعادةً بتيجي من الكاش من غير طلب شبكة إضافي
  async function getSurahAyahLengths(surahNumber) {
    const data = await cachedFetchJSON(`${BASE}/surah/${surahNumber}/quran-uthmani`);
    const ayahs = (data.data && data.data.ayahs) || [];
    return ayahs.map((a) => ({ numberInSurah: a.numberInSurah, length: (a.text || '').length }));
  }

  // 4️⃣ تفسير الميسر لآية محددة
  // المصدر الأساسي الآن قاعدة بيانات تفاسير مفتوحة المصدر عبر jsdelivr
  // (raw.githack/spa5k/tafsir_api) بدلاً من alquran.cloud وحدها. السبب:
  // نقطة alquran.cloud القديمة (ar.muyassar) بقت بترجع خطأ في كتير من
  // الحالات (على الأغلب بسبب تغيير في مسار/معرّف الإصدار من طرفهم)،
  // فكانت كل محاولة لفتح التفسير بتفشل وتظهر رسالة "تأكد من الاتصال
  // بالإنترنت" حتى لو النت شغال فعلاً، لأن أي فشل غير مرتبط بالأوفلاين
  // (كخطأ ٤٠٤ من الخادم) كان بيتعامل معه بمعزل عن حالة الاتصال الحقيقية.
  // ملاحظة: cdn.jsdelivr.net مُدرَج بالفعل ضمن المضيفين اللي الـ Service
  // Worker يخزّنهم دائمًا (انظر API_HOSTS في sw.js)، فالنتيجة هنا هتشتغل
  // بدون إنترنت تلقائيًا بمجرد ما المستخدم يفتح تفسير أي آية مرة واحدة.
  // لو المصدر الأساسي فشل لأي سبب، نرجع تلقائيًا لمحاولة alquran.cloud
  // القديمة كخط دفاع ثانٍ بدل ما نفشل على طول
  // تعريف إصدارات التفسير المتاحة في التطبيق. كل إصدار له معرّف slug في
  // قاعدة بيانات spa5k/tafsir_api عبر jsdelivr (نفس المصدر المستخدم أصلاً
  // للتفسير الميسّر)، بالإضافة لاسم العرض ومصدر منسوب يظهر تحت النص.
  // يُستخدم من هنا ومن واجهة اختيار نوع التفسير في app.js (القائمة المنسدلة
  // أسفل زرار "التفسير" في صفحة التفسير الكاملة)
  const TAFSIR_EDITIONS = {
    muyassar: {
      slug: 'ar-tafsir-muyassar',
      name: 'التفسير الميسر',
      source: 'التفسير الميسّر — مجمع الملك فهد لطباعة المصحف الشريف'
    },
    ibnkathir: {
      slug: 'ar-tafsir-ibn-kathir',
      name: 'تفسير ابن كثير',
      source: 'تفسير ابن كثير — الحافظ ابن كثير'
    },
    qurtubi: {
      slug: 'ar-tafseer-al-qurtubi',
      name: 'تفسير القرطبي',
      source: 'تفسير القرطبي — الجامع لأحكام القرآن'
    }
  };
  const DEFAULT_TAFSIR_EDITION = 'muyassar';

  // قائمة إصدارات التفسير المتاحة (تُستخدم لبناء القائمة المنسدلة في الواجهة)
  function getTafsirEditions() {
    return Object.keys(TAFSIR_EDITIONS).map((key) => ({ key, name: TAFSIR_EDITIONS[key].name }));
  }

  // 4️⃣ تفسير آية محددة من إصدار مُختار (افتراضيًا التفسير الميسّر لو محدّدش)
  // المصدر الأساسي الآن قاعدة بيانات تفاسير مفتوحة المصدر عبر jsdelivr
  // (raw.githack/spa5k/tafsir_api) بدلاً من alquran.cloud وحدها. السبب:
  // نقطة alquran.cloud القديمة (ar.muyassar) بقت بترجع خطأ في كتير من
  // الحالات (على الأغلب بسبب تغيير في مسار/معرّف الإصدار من طرفهم)،
  // فكانت كل محاولة لفتح التفسير بتفشل وتظهر رسالة "تأكد من الاتصال
  // بالإنترنت" حتى لو النت شغال فعلاً، لأن أي فشل غير مرتبط بالأوفلاين
  // (كخطأ ٤٠٤ من الخادم) كان بيتعامل معه بمعزل عن حالة الاتصال الحقيقية.
  // ملاحظة: cdn.jsdelivr.net مُدرَج بالفعل ضمن المضيفين اللي الـ Service
  // Worker يخزّنهم دائمًا (انظر API_HOSTS في sw.js)، فالنتيجة هنا هتشتغل
  // بدون إنترنت تلقائيًا بمجرد ما المستخدم يفتح تفسير أي آية مرة واحدة —
  // أو فورًا لأي إصدار حمّله المستخدم مسبقًا عبر downloadTafsirEdition أدناه.
  // لو المصدر الأساسي فشل لأي سبب مع التفسير الميسّر تحديدًا، نرجع تلقائيًا
  // لمحاولة alquran.cloud القديمة كخط دفاع ثانٍ بدل ما نفشل على طول؛ باقي
  // الإصدارات مالهاش مصدر احتياطي مكافئ فبترجّع الخطأ مباشرة
  async function getTafsir(surah, ayah, editionKey) {
    const key = (editionKey && TAFSIR_EDITIONS[editionKey]) ? editionKey : DEFAULT_TAFSIR_EDITION;
    const edition = TAFSIR_EDITIONS[key];
    const PRIMARY_URL = `https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir/${edition.slug}/${surah}/${ayah}.json`;
    try {
      const data = await cachedFetchJSON(PRIMARY_URL, 24 * 365);
      const text = String((data && (data.text || data.tafsir)) || '').trim();
      if (!text) throw new Error('لا يوجد نص تفسير في الاستجابة');
      return { text, source: edition.source };
    } catch (primaryErr) {
      if (key !== DEFAULT_TAFSIR_EDITION) throw primaryErr;
      const data = await cachedFetchJSON(`${BASE}/ayah/${surah}:${ayah}/ar.muyassar`);
      return { text: data.data.text, source: edition.source };
    }
  }

  // تفسير سورة كاملة دفعة واحدة (كل آياتها) من إصدار مُختار — يُستخدم في
  // تحميل إصدار تفسير كامل للعمل بدون إنترنت (١١٤ طلب فقط بدل ٦٢٣٦ طلب لكل
  // آية على حدة). نتحقق أولًا من Cache Storage (نفس مكان تحميل زر "تنزيل"
  // أدناه، مساحته كبيرة ومرتبطة بتخزين الجهاز)، فلو الإصدار كان محمَّل قبل
  // كده هنلاقيه فورًا بدون إنترنت؛ غير كده نرجع لـ cachedFetchJSON العادية
  // (تخزينها المحلي أصغر مساحة، بس كافية للقراءة العابرة أونلاين)
  async function getTafsirSurah(surahNumber, editionKey) {
    const key = (editionKey && TAFSIR_EDITIONS[editionKey]) ? editionKey : DEFAULT_TAFSIR_EDITION;
    const edition = TAFSIR_EDITIONS[key];
    const url = `https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir/${edition.slug}/${surahNumber}.json`;
    if ('caches' in window) {
      try {
        const cache = await caches.open(TAFSIR_API_CACHE_NAME);
        const cached = await cache.match(url);
        if (cached) {
          const data = await cached.json();
          return (data && data.ayahs) || [];
        }
      } catch (e) { /* تجاهل، نكمل بالطريقة العادية أدناه */ }
    }
    const data = await cachedFetchJSON(url, 24 * 365);
    return (data && data.ayahs) || [];
  }

  const TAFSIR_DOWNLOAD_FLAG_PREFIX = CACHE_PREFIX + 'tafsirDownloaded:';
  function isTafsirEditionDownloaded(editionKey) {
    try { return localStorage.getItem(TAFSIR_DOWNLOAD_FLAG_PREFIX + editionKey) === '1'; } catch (e) { return false; }
  }

  // جلب سورة تفسير واحدة **مع تحقق فعلي** من نجاح حفظها للعمل بدون إنترنت —
  // تُستخدم فقط من downloadTafsirEdition (زر "تنزيل" الصريح)، بخلاف getTafsirSurah
  // العادية اللي بتُستخدم للقراءة العابرة وتعتمد على localStorage (مساحته محدودة
  // جدًا: 5-10 ميجا تقريبًا) وممكن تفشل بصمت مع تفاسير كبيرة زي ابن كثير/القرطبي.
  // هنا بنستخدم Cache Storage (نفس مساحة الـ Service Worker، أكبر بكتير ومرتبطة
  // بمساحة تخزين الجهاز الفعلية)، وبنتحقق (cache.match) إن الحفظ نجح فعلًا قبل
  // ما نعتبر السورة "اتحمّلت" — لو فشل، نرمي خطأ حقيقي بدل ما نمرّ عليه بصمت
  async function fetchTafsirSurahForDownload(surahNumber, editionKey) {
    const edition = TAFSIR_EDITIONS[editionKey];
    const url = `https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir/${edition.slug}/${surahNumber}.json`;

    // لو المتصفح/الواجهة مش بتدعم Cache Storage (نادر جدًا)، نرجع للسلوك
    // القديم بدل ما نمنع الميزة كليًا
    if (!('caches' in window)) {
      const data = await cachedFetchJSON(url, 24 * 365);
      return (data && data.ayahs) || [];
    }

    const cache = await caches.open(TAFSIR_API_CACHE_NAME);
    let res = await cache.match(url);
    if (!res) {
      const netRes = await fetch(url);
      if (!netRes || !netRes.ok) throw new Error('تعذر الاتصال بالخادم: ' + (netRes && netRes.status));
      try {
        await cache.put(url, netRes.clone());
      } catch (cacheErr) {
        throw new Error('تعذّر حفظ التفسير محليًا — على الأغلب مساحة تخزين الجهاز ممتلئة');
      }
      // تحقق فعلي بعد الحفظ مباشرة، بدل افتراض إن cache.put نجح لمجرد إنه ما رماش خطأ
      const verify = await cache.match(url);
      if (!verify) throw new Error('تعذّر التحقق من حفظ التفسير محليًا، حاول مرة أخرى');
      res = netRes;
    }
    const data = await res.json();
    return (data && data.ayahs) || [];
  }

  // علم إلغاء بسيط لكل إصدار على حدة — يسمح بإيقاف تحميل شغّال في الخلفية
  // لو المستخدم ضغط زرار "جارٍ التنزيل..." تاني (انظر initPageTafsirOverlay في app.js)
  const tafsirDownloadCancelFlags = {};
  function cancelTafsirDownload(editionKey) { tafsirDownloadCancelFlags[editionKey] = true; }

  // تحميل إصدار تفسير كامل (١١٤ سورة) للعمل بدون إنترنت، على دفعات متوازية
  // صغيرة (٤ سور في نفس الوقت) بدل تباطؤ التحميل التتابعي أو إغراق الشبكة
  // بـ١١٤ طلب دفعة واحدة، مع استدعاء onProgress({completed,total}) بعد كل
  // سورة تكتمل حتى تتحدّث واجهة المستخدم تدريجيًا
  async function downloadTafsirEdition(editionKey, onProgress) {
    if (!TAFSIR_EDITIONS[editionKey]) throw new Error('إصدار تفسير غير معروف');
    tafsirDownloadCancelFlags[editionKey] = false;
    const total = 114;
    let completed = 0;
    const CONCURRENCY = 4;
    const surahNumbers = Array.from({ length: total }, (_, i) => i + 1);
    let idx = 0;

    async function worker() {
      while (idx < surahNumbers.length) {
        if (tafsirDownloadCancelFlags[editionKey]) {
          const err = new Error('تم إلغاء التحميل');
          err.name = 'CancelledError';
          throw err;
        }
        const n = surahNumbers[idx++];
        let lastErr = null;
        let done = false;
        for (let attempt = 0; attempt < 3 && !done; attempt++) {
          try {
            await fetchTafsirSurahForDownload(n, editionKey);
            done = true;
          } catch (e) {
            lastErr = e;
          }
        }
        if (!done) throw lastErr || new Error('تعذّر تحميل التفسير');
        completed++;
        if (typeof onProgress === 'function') onProgress({ completed, total });
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    try { localStorage.setItem(TAFSIR_DOWNLOAD_FLAG_PREFIX + editionKey, '1'); } catch (e) { /* عند امتلاء الذاكرة */ }
  }

  // ترجمة إنجليزية للآية (يُعرض تحت بطاقة "Golden Quraan English" في خيارات
  // الآية) — إصدار Saheeh International الموثوق عبر alquran.cloud، بنفس
  // آلية التخزين المؤقت المستخدمة في باقي دوال هذا الملف
  async function getTranslationEn(surah, ayah) {
    const data = await cachedFetchJSON(`${BASE}/ayah/${surah}:${ayah}/en.sahih`, 24 * 365);
    const text = String((data && data.data && data.data.text) || '').trim();
    if (!text) throw new Error('لا توجد ترجمة إنجليزية متاحة لهذه الآية');
    return { text, source: 'Saheeh International' };
  }

  // المتشابهات اللفظية: آيات أخرى تشترك مع هذه الآية في عبارة لفظية واضحة (٤
  // كلمات متتالية فأكثر)، عبر البحث النصي الحرفي المتاح أصلاً (searchQuran).
  // نجرّب عدة "نوافذ" من كلمات الآية الحالية، ونجمع أي آية أخرى (غير الآية
  // نفسها) ظهرت في نتائجها، فتُبنى القائمة من نص القرآن الفعلي دائمًا
  // ولا تُختلق بأي شكل
  function stripTashkeelForMatch(str) {
    return String(str || '')
      .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED\u0640]/g, '')
      .replace(/[﴿﴾]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  async function getMutashabihat(surah, ayah, ayahText) {
    const clean = stripTashkeelForMatch(ayahText).replace(/[\u06DD].*$/, '').trim();
    const words = clean.split(' ').filter(Boolean);
    if (words.length < 4) return [];

    const windows = [];
    for (let i = 0; i + 4 <= words.length && windows.length < 3; i += 4) {
      windows.push(words.slice(i, i + 4).join(' '));
    }
    if (!windows.length) windows.push(words.slice(0, 4).join(' '));

    const seen = new Map();
    for (const w of windows) {
      try {
        const results = await searchQuran(w);
        results.forEach((r) => {
          const key = `${r.surahNum}:${r.ayahNum}`;
          if (key === `${surah}:${ayah}`) return;
          if (!seen.has(key)) seen.set(key, r);
        });
      } catch (e) { /* نتجاهل فشل نافذة بحث واحدة ونكمل الباقي */ }
      if (seen.size >= 8) break;
    }
    return Array.from(seen.values()).slice(0, 6);
  }

  // قائمة القراء المتاحين للاستماع (معرّفات إصدارات الصوت في شبكة alquran.cloud / cdn.islamic.network،
  // أو معرّفات داخلية للقراء اللي مصدرهم مخصص بالكامل من everyayah.com / mp3quran.net).
  // القائمة مرتّبة أبجديًا بالاسم العربي
  const RECITERS = [
    { id: 'ar.shaatree', name: 'أبو بكر الشاطري', nameLatin: 'Abu Bakr Al-Shatri', nameRu: 'Абу Бакр аш-Шатри' },
    { id: 'ar.ahmedajamy', name: 'أحمد العجمي', nameLatin: 'Ahmed Al-Ajmy', nameRu: 'Ахмад аль-Аджми' },
    { id: 'way2quran.ahmednasr.hafs', name: 'أحمد عبد الرازق نصر', nameLatin: 'Ahmed Abdel Razeq Nasr', nameRu: 'Ахмед Абдель Разек Наср', mushafEdition: 'hafs', surahList: '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114' },
    { id: 'ar.hudhaify', name: 'الحذيفي', nameLatin: 'Al-Hudhaify', nameRu: 'Аль-Хузейфи' },
    { id: 'ar.islamsobhi', name: 'إسلام صبحي', nameLatin: 'Islam Sobhi', nameRu: 'Ислам Собхи' },
    { id: 'ar.badralturki', name: 'بدر التركي', nameLatin: 'Badr Al-Turki', nameRu: 'Бадр ат-Турки' },
    { id: 'ar.saadalghamdi', name: 'سعد الغامدي', nameLatin: 'Saad Al-Ghamdi', nameRu: 'Саад аль-Гамди' },
    { id: 'ar.saoodshuraym', name: 'سعود الشريم', nameLatin: 'Saud Al-Shuraim', nameRu: 'Сауд аш-Шурейм' },
    { id: 'ar.abdulbasitmurattal', name: 'عبد الباسط عبد الصمد (مرتل)', nameLatin: 'Abdul Basit Abdul Samad (Murattal)', nameRu: 'Абдул Басыт Абдус Самад (Муратталь)' },
    { id: 'ar.abdurrahmaansudais', name: 'عبد الرحمن السديس', nameLatin: 'Abdul Rahman Al-Sudais', nameRu: 'Абдуррахман ас-Судайс' },
    { id: 'ar.abdullahbasfar', name: 'عبد الله بصفر', nameLatin: 'Abdullah Basfar', nameRu: 'Абдуллах Басфар' },
    { id: 'ar.alijaber', name: 'علي جابر', nameLatin: 'Ali Jaber', nameRu: 'Али Джабер' },
    { id: 'ar.faresabbad', name: 'فارس عباد', nameLatin: 'Fares Abbad', nameRu: 'Фарис Аббад' },
    { id: 'ar.mahermuaiqly', name: 'ماهر المعيقلي', nameLatin: 'Maher Al-Muaiqly', nameRu: 'Махер аль-Муайкли' },
    { id: 'ar.mohamedtablawi', name: 'محمد الطبلاوي', nameLatin: 'Mohamed Al-Tablawi', nameRu: 'Мухаммад ат-Таблави' },
    { id: 'ar.muhammadayyoub', name: 'محمد أيوب', nameLatin: 'Muhammad Ayyub', nameRu: 'Мухаммад Айюб' },
    { id: 'ar.muhammadjibreel', name: 'محمد جبريل', nameLatin: 'Muhammad Jibreel', nameRu: 'Мухаммад Джибриль' },
    { id: 'ar.minshawi', name: 'محمد صديق المنشاوي', nameLatin: 'Muhammad Siddiq Al-Minshawi', nameRu: 'Мухаммад Сиддик аль-Миншави' },
    { id: 'ar.husary', name: 'محمود خليل الحصري', nameLatin: 'Mahmoud Khalil Al-Husary', nameRu: 'Махмуд Халиль аль-Хусари' },
    { id: 'ar.mahmoudalialbanna', name: 'محمود علي البنا', nameLatin: 'Mahmoud Ali Al-Banna', nameRu: 'Махмуд Али аль-Банна' },
    { id: 'ar.alafasy', name: 'مشاري العفاسي', nameLatin: 'Mishary Al-Afasy', nameRu: 'Мишари аль-Афаси' },
    { id: 'ar.nasseralqatami', name: 'ناصر القطامي', nameLatin: 'Nasser Al-Qatami', nameRu: 'Насер аль-Катами' },
    { id: 'ar.haithamaldukhain', name: 'هيثم الدخين', nameLatin: 'Haitham Al-Dukhain', nameRu: 'Хайсам ад-Духайн' },
    { id: 'ar.yasseraldosari', name: 'ياسر الدوسري', nameLatin: 'Yasser Al-Dosari', nameRu: 'Ясер ад-Доссари' },
    // ستة قراء "تلاوات مجودة" (المصحف المجوَّد الكامل، وليس المرتَّل) —
    // تُعرض في تاب خاص باسم "تلاوات مجودة" داخل صفحة الصوتيات (انظر
    // renderMujawwadRecitersGrid في app.js)، ومصدرهم كلهم مكتبة mp3quran.net
    // الرسمية عبر CUSTOM_SURAH_AUDIO تحت (تم التحقق من كل رابط يدويًا من
    // صفحة كل قارئ على mp3quran.net نفسها). موجودون هنا كمان في RECITERS
    // العادية (بنفس فكرة هيثم الدخين وأمثاله) عشان يشتغلوا تلقائيًا مع كل
    // آليات التحميل/الاستماع/التسمية الموجودة من غير أي كود إضافي
    { id: 'ar.minshawimjwd', name: 'محمد صديق المنشاوي (مجود)', nameLatin: 'Muhammad Siddiq Al-Minshawi (Mujawwad)', nameRu: 'Мухаммад Сиддик аль-Миншави (Муджаввад)' },
    { id: 'ar.husarymjwd', name: 'محمود خليل الحصري (مجود)', nameLatin: 'Mahmoud Khalil Al-Husary (Mujawwad)', nameRu: 'Махмуд Халиль аль-Хусари (Муджаввад)' },
    { id: 'ar.abdulbasitmjwd', name: 'عبد الباسط عبد الصمد (مجود)', nameLatin: 'Abdul Basit Abdul Samad (Mujawwad)', nameRu: 'Абдул Басыт Абдус Самад (Муджаввад)' },
    { id: 'ar.tablawimjwd', name: 'محمد الطبلاوي (مجود)', nameLatin: 'Mohamed Al-Tablawi (Mujawwad)', nameRu: 'Мухаммад ат-Таблави (Муджаввад)' },
    { id: 'ar.bannamjwd', name: 'محمود علي البنا (مجود)', nameLatin: 'Mahmoud Ali Al-Banna (Mujawwad)', nameRu: 'Махмуд Али аль-Банна (Муджаввад)' },
    { id: 'ar.mustafaismail', name: 'مصطفى إسماعيل (مجود)', nameLatin: 'Mustafa Ismail (Mujawwad)', nameRu: 'Мустафа Исмаил (Муджаввад)' },
    // تسجيلات الروايات غير حفص من فهرس MP3Quran الرسمي. هذه التسجيلات
    // ملفات سورة كاملة، لذلك تُعامل كصوت مخصص ولا تُطلب بمعرّفات alquran.cloud.
    { id: 'warsh.husary', name: 'محمود خليل الحصري — ورش', nameLatin: 'Mahmoud Khalil Al-Husary (Warsh)', nameRu: 'Махмуд Халиль аль-Хусари (Варш)', mushafEdition: 'warsh' },
    { id: 'warsh.abdulbasit', name: 'عبد الباسط عبد الصمد — ورش', nameLatin: 'Abdul Basit Abdul Samad (Warsh)', nameRu: 'Абдул Басыт Абдус Самад (Варш)', mushafEdition: 'warsh' },
    { id: 'warsh.omaralqazabri', name: 'عمر القزابري — ورش', nameLatin: 'Omar Al-Qazabri (Warsh)', nameRu: 'Омар аль-Казабри (Варш)', mushafEdition: 'warsh' },
    { id: 'warsh.koshi', name: 'العيون الكوشي — ورش', nameLatin: 'Al-Oyoun Al-Koshi (Warsh)', nameRu: 'Аль-Оюн аль-Коши (Варш)', mushafEdition: 'warsh' },
    { id: 'warsh.ibrahimdosari', name: 'إبراهيم الدوسري — ورش', nameLatin: 'Ibrahim Al-Dosari (Warsh)', nameRu: 'Ибрахим ад-Досари (Варш)', mushafEdition: 'warsh' },
    { id: 'qalun.husary', name: 'محمود خليل الحصري — قالون', nameLatin: 'Mahmoud Khalil Al-Husary (Qalun)', nameRu: 'Махмуд Халиль аль-Хусари (Калун)', mushafEdition: 'qalun' },
    { id: 'qalun.hudhaify', name: 'علي الحذيفي — قالون', nameLatin: 'Ali Al-Hudhaify (Qalun)', nameRu: 'Али аль-Хузейфи (Калун)', mushafEdition: 'qalun' },
    { id: 'qalun.tarabulsi', name: 'أحمد الطرابلسي — قالون', nameLatin: 'Ahmed Al-Tarabulsi (Qalun)', nameRu: 'Ахмад ат-Тарабулси (Калун)', mushafEdition: 'qalun' },
    { id: 'qalun.dokali', name: 'الدوكالي محمد العالم — قالون', nameLatin: 'Al-Dokali Mohamed Al-Alam (Qalun)', nameRu: 'Ад-Докали Мухаммад аль-Алам (Калун)', mushafEdition: 'qalun' },
    { id: 'qalun.qeniwa', name: 'محمد الأمين قنيوة — قالون', nameLatin: 'Mohamed Al-Amin Qeniwa (Qalun)', nameRu: 'Мухаммад аль-Амин Кенийва (Калун)', mushafEdition: 'qalun' },
    { id: 'susi.soufi', name: 'عبد الرشيد صوفي — السوسي', nameLatin: 'Abdul Rashid Soufi (Al-Susi)', nameRu: 'Абдуррашид ас-Суфи (ас-Суси)', mushafEdition: 'susi' },
    // مصاحف كاملة تم التحقق من توفر 114 سورة وروابط التشغيل على Way2Quran.
    { id: 'way2quran.mohamed-albarak.hafs', name: 'محمد البراك', nameLatin: 'Mohamed Albarak', nameRu: 'Mohamed Albarak', mushafEdition: 'hafs', surahList: '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114' },
    { id: 'way2quran.hassan-saleh.hafs', name: 'حسن محمد صالح', nameLatin: 'Hassan Mohamed Saleh', nameRu: 'Hassan Mohamed Saleh', mushafEdition: 'hafs', surahList: '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114' },
    { id: 'way2quran.bandar-balila.hafs', name: 'بندر بليلة', nameLatin: 'Bandar Balila', nameRu: 'Bandar Balila', mushafEdition: 'hafs', surahList: '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114' },
    { id: 'way2quran.abdullah-kamel.hafs', name: 'عبد الله كامل', nameLatin: 'Abdullah Kamel', nameRu: 'Abdullah Kamel', mushafEdition: 'hafs', surahList: '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114' },
    { id: 'way2quran.ahmed-al-nafis.hafs', name: 'أحمد النفيس', nameLatin: 'Ahmed Al Nafis', nameRu: 'Ahmed Al Nafis', mushafEdition: 'hafs', surahList: '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114' },
    { id: 'way2quran.ahmed-nainaa.hafs', name: 'أحمد نعينع', nameLatin: 'Ahmed Nainaa', nameRu: 'Ahmed Nainaa', mushafEdition: 'hafs', surahList: '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114' },
    { id: 'way2quran.abdullah-al-juhani.hafs', name: 'عبد الله عواد الجهني', nameLatin: 'Abdullah Al Juhani', nameRu: 'Abdullah Al Juhani', mushafEdition: 'hafs', surahList: '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114' },
    { id: 'way2quran.tawfiq-al-sayegh.hafs', name: 'توفيق الصايغ', nameLatin: 'Tawfiq Al Sayegh', nameRu: 'Tawfiq Al Sayegh', mushafEdition: 'hafs', surahList: '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114' },
    { id: 'way2quran.yasser-salama.hafs', name: 'ياسر سلامة', nameLatin: 'Yasser Salama', nameRu: 'Yasser Salama', mushafEdition: 'hafs', surahList: '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114' },
    { id: 'way2quran.salah-boukhatir.hafs', name: 'صلاح بوخاطر', nameLatin: 'Salah Boukhatir', nameRu: 'Salah Boukhatir', mushafEdition: 'hafs', surahList: '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114' },
    { id: 'way2quran.khaled-al-mihanna.hafs', name: 'خالد المهنا', nameLatin: 'Khaled Al Mihanna', nameRu: 'Khaled Al Mihanna', mushafEdition: 'hafs', surahList: '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114' },
    { id: 'way2quran.saleh-al-ansari.hafs', name: 'صالح الأنصاري', nameLatin: 'Saleh Al Ansari', nameRu: 'Saleh Al Ansari', mushafEdition: 'hafs', surahList: '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114' },
    { id: 'way2quran.omar-al-dariwez.hafs', name: 'عمر أحمد الدريويز', nameLatin: 'Omar Al Dariwez', nameRu: 'Omar Al Dariwez', mushafEdition: 'hafs', surahList: '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114' },
    { id: 'way2quran.mustafa-al-lahouni.hafs', name: 'مصطفى اللاهوني', nameLatin: 'Mustafa Al Lahouni', nameRu: 'Mustafa Al Lahouni', mushafEdition: 'hafs', surahList: '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114' },
    { id: 'way2quran.mansour-al-salmi.hafs', name: 'منصور السالمي', nameLatin: 'Mansour Al Salmi', nameRu: 'Mansour Al Salmi', mushafEdition: 'hafs', surahList: '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114' },
    { id: 'way2quran.wadih-al-yamani.hafs', name: 'وديع اليمني', nameLatin: 'Wadih Al Yamani', nameRu: 'Wadih Al Yamani', mushafEdition: 'hafs', surahList: '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114' },
    { id: 'way2quran.muhammad-dybyrwf.hafs', name: 'محمد ديبيروف', nameLatin: 'Muhammad Dybyrwf', nameRu: 'Muhammad Dybyrwf', mushafEdition: 'hafs', surahList: '2,50,67,68,72,75,76,79,89' },
    { id: 'way2quran.yassin-al-jazairi.warsh', name: 'ياسين الجزائري', nameLatin: 'Yassin Al-Jazairi', nameRu: 'Yassin Al-Jazairi', mushafEdition: 'warsh', surahList: '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114' },
  ];

  // روابط مباشرة لسور كاملة من مكتبة mp3quran.net لقراء لا تتوفر تلاواتهم على شبكة
  // cdn.islamic.network (تسجيلات حديثة تمّ التحقق من مصدرها يدويًا). المفتاح هو نفس
  // معرّف القارئ في RECITERS أعلاه، والقيمة دالة تبني رابط ملف mp3 لرقم سورة معيّن
  // (أرقام السور هنا بصيغة 3 خانات مثل 001 وليس 1، بخلاف نمط cdn.islamic.network)
  // ملاحظة مهمة: روابط ملفات mp3quran.net الفعلية تمر عبر مسار "/download/" وليس
  // مباشرة تحت اسم القارئ (تم التحقق من المسار الصحيح يدويًا من صفحات الموقع نفسه)،
  // وبدون هذا الجزء من الرابط كانت كل السور بهؤلاء القراء تفشل بصمت
  // تُستخدم هذه الروابط بس لزرار "تشغيل السورة كاملة" وللقراء اللي مفيش لهم تسجيل
  // آية-بآية حقيقي متاح في أي مكان (زي هيثم الدخين وعلي جابر)، انظر CUSTOM_AYAH_AUDIO تحت.
  // ملاحظة: باقي القراء الجداد (الحذيفي، محمد أيوب، أبو بكر الشاطري، ناصر القطامي،
  // عبد الله بصفر، محمد الطبلاوي، محمود علي البنا، محمد جبريل) معرّفاتهم موجودة
  // فعليًا في فهرس alquran.cloud نفسه (versebyverse أو surahbysurah)، فسورهم الكاملة
  // بتتحمّل تلقائيًا من cdn.islamic.network عن طريق getSurahAudioURL الافتراضية تحت
  // من غير ما يحتاجوا سطر هنا، وبيفضل بس آية-بآية بتاعتهم مصدرها everyayah.com (تحت)
  const CUSTOM_SURAH_AUDIO = {
    'way2quran.mohamed-albarak.hafs': (n) => `https://media.way2quran.com/mohamed-albarak/hafs-an-asim/${String(n).padStart(3, '0')}.mp3`,
    'way2quran.hassan-saleh.hafs': (n) => `https://media.way2quran.com/hassan-saleh/hafs-an-asim/${String(n).padStart(3, '0')}.mp3`,
    'way2quran.bandar-balila.hafs': (n) => `https://media.way2quran.com/bandar-balila/hafs-an-asim/${String(n).padStart(3, '0')}.mp3`,
    'way2quran.abdullah-kamel.hafs': (n) => `https://media.way2quran.com/abdullah-kamel/hafs-an-asim/${String(n).padStart(3, '0')}.mp3`,
    'way2quran.ahmed-al-nafis.hafs': (n) => `https://media.way2quran.com/ahmed-al-nafis/hafs-an-asim/${String(n).padStart(3, '0')}.mp3`,
    'way2quran.ahmed-nainaa.hafs': (n) => `https://media.way2quran.com/ahmed-nainaa/hafs-an-asim/${String(n).padStart(3, '0')}.mp3`,
    'way2quran.abdullah-al-juhani.hafs': (n) => `https://media.way2quran.com/abdullah-al-juhani/hafs-an-asim/${String(n).padStart(3, '0')}.mp3`,
    'way2quran.tawfiq-al-sayegh.hafs': (n) => `https://media.way2quran.com/tawfiq-al-sayegh/hafs-an-asim/${String(n).padStart(3, '0')}.mp3`,
    'way2quran.yasser-salama.hafs': (n) => `https://media.way2quran.com/yasser-salama/hafs-an-asim/${String(n).padStart(3, '0')}.mp3`,
    'way2quran.salah-boukhatir.hafs': (n) => `https://media.way2quran.com/salah-boukhatir/hafs-an-asim/${String(n).padStart(3, '0')}.mp3`,
    'way2quran.khaled-al-mihanna.hafs': (n) => `https://media.way2quran.com/khaled-al-mihanna/hafs-an-asim/${String(n).padStart(3, '0')}.mp3`,
    'way2quran.saleh-al-ansari.hafs': (n) => `https://media.way2quran.com/saleh-al-ansari/hafs-an-asim/${String(n).padStart(3, '0')}.mp3`,
    'way2quran.omar-al-dariwez.hafs': (n) => `https://media.way2quran.com/omar-al-dariwez/hafs-an-asim/${String(n).padStart(3, '0')}.mp3`,
    'way2quran.mustafa-al-lahouni.hafs': (n) => `https://media.way2quran.com/mustafa-al-lahouni/hafs-an-asim/${String(n).padStart(3, '0')}.mp3`,
    'way2quran.mansour-al-salmi.hafs': (n) => `https://media.way2quran.com/mansour-al-salmi/hafs-an-asim/${String(n).padStart(3, '0')}.mp3`,
    'way2quran.wadih-al-yamani.hafs': (n) => `https://media.way2quran.com/wadih-al-yamani/hafs-an-asim/${String(n).padStart(3, '0')}.mp3`,
    'way2quran.muhammad-dybyrwf.hafs': (n) => `https://media.way2quran.com/muhammad-dybyrwf/hafs-an-asim/${String(n).padStart(3, '0')}.mp3`,
    'way2quran.yassin-al-jazairi.warsh': (n) => `https://media.way2quran.com/yassin-al-jazairi/warsh-an-nafi/${String(n).padStart(3, '0')}.mp3`,
    // أحمد عبد الرازق نصر — مصدر الطريق إلى القرآن، حفص عن عاصم (114 سورة).
    'way2quran.ahmednasr.hafs': (n) => `https://media.way2quran.com/ahmed-nasr/hafs-an-asim/${String(n).padStart(3, '0')}.mp3`,
    'ar.yasseraldosari': (n) => `https://server11.mp3quran.net/download/yasser/${String(n).padStart(3, '0')}.mp3`,
    'ar.faresabbad': (n) => `https://server8.mp3quran.net/download/frs_a/${String(n).padStart(3, '0')}.mp3`,
    // استخدم نفس مجلد الصوت الذي تعيده واجهة التوقيت الرسمية (read=273)،
    // حتى لا تُطبّق نقاط آيات ملف على نسخة تسجيل مختلفة.
    'ar.haithamaldukhain': (n) => `https://server16.mp3quran.net/download/h_dukhain/Rewayat-Hafs-A-n-Assem/${String(n).padStart(3, '0')}.mp3`,
    'ar.saadalghamdi': (n) => `https://server7.mp3quran.net/download/s_gmd/${String(n).padStart(3, '0')}.mp3`,
    // بدر التركي وإسلام صبحي: نفس أسلوب هيثم الدخين (ملف سورة كاملة فقط من مكتبة
    // mp3quran.net، تم التحقق من مسار الرابط الفعلي يدويًا من صفحة كل سورة على الموقع)
    'ar.badralturki': (n) => `https://server10.mp3quran.net/download/bader/Rewayat-Hafs-A-n-Assem/${String(n).padStart(3, '0')}.mp3`,
    // رابط إسلام صبحي الرسمي الحالي في فهرس MP3Quran.
    'ar.islamsobhi': (n) => `https://server14.mp3quran.net/download/islam/Rewayat-Hafs-A-n-Assem/${String(n).padStart(3, '0')}.mp3`,
    // علي جابر: مش موجود في فهرس alquran.cloud أصلاً، فمحتاج رابط سورة كاملة يدوي
    // زي هيثم الدخين (تم التحقق من مسار الرابط الفعلي يدويًا من صفحة السورة على mp3quran.net)
    'ar.alijaber': (n) => `https://server11.mp3quran.net/download/a_jbr/${String(n).padStart(3, '0')}.mp3`,
    // تلاوات مجودة (المصحف المجود الكامل) — روابط رسمية من مكتبة mp3quran.net
    // نفسها (تم التحقق من مسار كل رابط يدويًا من صفحة كل قارئ/سورة على
    // الموقع، بما في ذلك بادئة "/download/" الإلزامية زي باقي روابط الموقع فوق)
    'ar.minshawimjwd': (n) => `https://server10.mp3quran.net/download/minsh/Almusshaf-Al-Mojawwad/${String(n).padStart(3, '0')}.mp3`,
    'ar.husarymjwd': (n) => `https://server13.mp3quran.net/download/husr/Almusshaf-Al-Mojawwad/${String(n).padStart(3, '0')}.mp3`,
    'ar.abdulbasitmjwd': (n) => `https://server7.mp3quran.net/download/basit/Almusshaf-Al-Mojawwad/${String(n).padStart(3, '0')}.mp3`,
    'ar.tablawimjwd': (n) => `https://server12.mp3quran.net/download/tblawi/Al-Mojawwad/${String(n).padStart(3, '0')}.mp3`,
    'ar.bannamjwd': (n) => `https://server8.mp3quran.net/download/bna/Almusshaf-Al-Mojawwad/${String(n).padStart(3, '0')}.mp3`,
    'ar.mustafaismail': (n) => `https://server8.mp3quran.net/download/mustafa/Almusshaf-Al-Mojawwad/${String(n).padStart(3, '0')}.mp3`,
    'warsh.husary': (n) => `https://server13.mp3quran.net/husr/Rewayat-Warsh-A-n-Nafi/${String(n).padStart(3, '0')}.mp3`,
    'warsh.abdulbasit': (n) => `https://server7.mp3quran.net/basit/Rewayat-Warsh-A-n-Nafi/${String(n).padStart(3, '0')}.mp3`,
    'warsh.omaralqazabri': (n) => `https://server9.mp3quran.net/omar_warsh/${String(n).padStart(3, '0')}.mp3`,
    'warsh.koshi': (n) => `https://server11.mp3quran.net/koshi/${String(n).padStart(3, '0')}.mp3`,
    'warsh.ibrahimdosari': (n) => `https://server10.mp3quran.net/ibrahim_dosri/Rewayat-Warsh-A-n-Nafi/${String(n).padStart(3, '0')}.mp3`,
    'qalun.husary': (n) => `https://server13.mp3quran.net/husr/Rewayat-Qalon-A-n-Nafi/${String(n).padStart(3, '0')}.mp3`,
    'qalun.hudhaify': (n) => `https://server9.mp3quran.net/huthifi_qalon/${String(n).padStart(3, '0')}.mp3`,
    'qalun.tarabulsi': (n) => `https://server10.mp3quran.net/trablsi/${String(n).padStart(3, '0')}.mp3`,
    'qalun.dokali': (n) => `https://server7.mp3quran.net/dokali/${String(n).padStart(3, '0')}.mp3`,
    'qalun.qeniwa': (n) => `https://server16.mp3quran.net/qeniwa/Rewayat-Qalon-A-n-Nafi/${String(n).padStart(3, '0')}.mp3`,
    'susi.soufi': (n) => `https://server16.mp3quran.net/soufi/Rewayat-Assosi-A-n-Abi-Amr/${String(n).padStart(3, '0')}.mp3`
  };
  // بعض المصادر (مثل ملفات مداد) ترجع روابط تنزيل موقعة ومؤقتة لكل سورة.
  // نحتفظ بالرابط بعد جلبه حتى يظل المشغل وميزة التحميل يستخدمان نفس المسار.
  const CUSTOM_SURAH_AUDIO_URLS = Object.create(null);
  const CUSTOM_SURAH_AUDIO_RESOLVERS = Object.create(null);

  // روابط آية-بآية حقيقية ودقيقة ١٠٠٪ (مش تقدير)، من مكتبة everyayah.com — أرشيف
  // صوتي موثوق ومستخدم من عشرات تطبيقات القرآن منذ أكتر من عشر سنين، وفيه تسجيلات
  // مقسّمة آية بآية فعليًا لكل القراء دول (تم التحقق من اسم مجلد كل قارئ يدويًا من
  // ملف الفهرس الرسمي recitations.js على everyayah.com نفسه، مع اختيار أعلى جودة
  // متاحة لكل قارئ). هيثم الدخين وإسلام صبحي يعتمدان على ملف سورة كاملة،
  // وتُرفق بهما الآن خرائط توقيت محلية مرتبطة بملفات MP3Quran المطابقة.
  // نمط اسم الملف: رقم السورة ٣ خانات + رقم الآية ٣ خانات، مثال: 083010.mp3 = سورة ٨٣ آية ١٠
  const CUSTOM_AYAH_AUDIO = {
    'ar.yasseraldosari': (s, a) => `https://everyayah.com/data/Yasser_Ad-Dussary_128kbps/${String(s).padStart(3, '0')}${String(a).padStart(3, '0')}.mp3`,
    'ar.faresabbad': (s, a) => `https://everyayah.com/data/Fares_Abbad_64kbps/${String(s).padStart(3, '0')}${String(a).padStart(3, '0')}.mp3`,
    'ar.saadalghamdi': (s, a) => `https://everyayah.com/data/Ghamadi_40kbps/${String(s).padStart(3, '0')}${String(a).padStart(3, '0')}.mp3`,
    // القراء التسعة اللي انضافوا حديثًا — مصدرهم everyayah.com بالكامل عشان نفس
    // مشكلة دقة "البداية من نص الآية اللي قبلها" اللي كانت موجودة مع قراء زي
    // الدوسري وفارس عباد قبل التصحيح (انظر ملاحظة CUSTOM_SURAH_AUDIO فوق)
    'ar.hudhaify': (s, a) => `https://everyayah.com/data/Hudhaify_128kbps/${String(s).padStart(3, '0')}${String(a).padStart(3, '0')}.mp3`,
    'ar.muhammadayyoub': (s, a) => `https://everyayah.com/data/Muhammad_Ayyoub_128kbps/${String(s).padStart(3, '0')}${String(a).padStart(3, '0')}.mp3`,
    'ar.shaatree': (s, a) => `https://everyayah.com/data/Abu_Bakr_Ash-Shaatree_128kbps/${String(s).padStart(3, '0')}${String(a).padStart(3, '0')}.mp3`,
    'ar.nasseralqatami': (s, a) => `https://everyayah.com/data/Nasser_Alqatami_128kbps/${String(s).padStart(3, '0')}${String(a).padStart(3, '0')}.mp3`,
    'ar.alijaber': (s, a) => `https://everyayah.com/data/Ali_Jaber_64kbps/${String(s).padStart(3, '0')}${String(a).padStart(3, '0')}.mp3`,
    'ar.abdullahbasfar': (s, a) => `https://everyayah.com/data/Abdullah_Basfar_192kbps/${String(s).padStart(3, '0')}${String(a).padStart(3, '0')}.mp3`,
    'ar.mohamedtablawi': (s, a) => `https://everyayah.com/data/Mohammad_al_Tablaway_128kbps/${String(s).padStart(3, '0')}${String(a).padStart(3, '0')}.mp3`,
    'ar.mahmoudalialbanna': (s, a) => `https://everyayah.com/data/mahmoud_ali_al_banna_32kbps/${String(s).padStart(3, '0')}${String(a).padStart(3, '0')}.mp3`,
    'ar.muhammadjibreel': (s, a) => `https://everyayah.com/data/Muhammad_Jibreel_128kbps/${String(s).padStart(3, '0')}${String(a).padStart(3, '0')}.mp3`
  };

  // هل هذا القارئ من القراء الذين لا تتوفر لهم إلا ملفات سورة كاملة (بلا أي تسجيل
  // آية-بآية حقيقي في أي مكان)؟ القراء اللي عندهم رابط آية-بآية حقيقي في
  // CUSTOM_AYAH_AUDIO ميتحسبوش هنا حتى لو كان عندهم كمان ملف سورة كاملة، عشان
  // يشتغلوا بالمسار العادي (فتح ملف الآية المطلوبة مباشرة بدقة كاملة)
  function isCustomAudioReciter(editionId) {
    return !!CUSTOM_SURAH_AUDIO[editionId] && !CUSTOM_AYAH_AUDIO[editionId];
  }

  // هل هذا القارئ عنده رابط آية-بآية حقيقي ودقيق (مش ملف سورة كاملة بالتقريب)؟
  // صحيح لكل القراء العاديين (اللي بيجيبوا صوتهم من alquran.cloud أصلاً) ولقراء
  // CUSTOM_AYAH_AUDIO الثلاثة (الدوسري/فارس عباد/الغامدي). غلط بس لقراء
  // isCustomAudioReciter (هيثم الدخين وأمثاله، اللي مفيش لهم أي تسجيل آية-بآية
  // في أي مصدر). تُستخدم في app.js لتحديد هل نحمّل/نشغّل ملفات آية-بآية دقيقة
  // بدل التقريب من ملف السورة الكاملة، حتى في وضع التحميل للاستماع بدون إنترنت
  function hasRealAyahAudio(editionId) {
    return !isCustomAudioReciter(editionId);
  }

  function hasEveryAyahAudio(editionId) {
    return !!CUSTOM_AYAH_AUDIO[editionId];
  }

  // رابط ملف صوتي لسورة كاملة بصوت قارئ محدد
  function getSurahAudioURL(surahNumber, editionId) {
    const ed = editionId || 'ar.alafasy';
    const cachedUrl = CUSTOM_SURAH_AUDIO_URLS[ed] && CUSTOM_SURAH_AUDIO_URLS[ed][Number(surahNumber)];
    if (cachedUrl) return cachedUrl;
    if (CUSTOM_SURAH_AUDIO[ed]) return CUSTOM_SURAH_AUDIO[ed](surahNumber);
    return `https://cdn.islamic.network/quran/audio-surah/128/${ed}/${surahNumber}.mp3`;
  }

  function setCustomSurahAudioURL(id, surahNumber, url) {
    const n = Number(surahNumber);
    if (!id || !Number.isInteger(n) || n < 1 || n > 114 || !/^https:\/\//i.test(String(url || ''))) return false;
    if (!CUSTOM_SURAH_AUDIO_URLS[id]) CUSTOM_SURAH_AUDIO_URLS[id] = Object.create(null);
    CUSTOM_SURAH_AUDIO_URLS[id][n] = String(url);
    return true;
  }

  async function ensureCustomSurahAudioURL(id, surahNumber) {
    const n = Number(surahNumber);
    if (CUSTOM_SURAH_AUDIO_URLS[id] && CUSTOM_SURAH_AUDIO_URLS[id][n]) return CUSTOM_SURAH_AUDIO_URLS[id][n];
    const resolver = CUSTOM_SURAH_AUDIO_RESOLVERS[id];
    if (!resolver) return null;
    const url = await resolver(n);
    return setCustomSurahAudioURL(id, n, url) ? url : null;
  }

  // تسجيل مصاحف تعليمية مصدرها فهرس خارجي موثوق؛ تظل روابطها ضمن نفس
  // مسار المشغّل والتنزيل المستخدم لباقي القراء.
  function registerCustomSurahReciter({ id, name, server, nameLatin, nameRu, urlResolver, mushafEdition, surahList, moshafId, readKind, timingReadId, catalogSource }) {
    if (!id || !name || ((!server || !/^https:\/\//i.test(server)) && typeof urlResolver !== 'function')) return false;
    const normalizedServer = server && /^https:\/\//i.test(server) ? (server.endsWith('/') ? server : `${server}/`) : null;
    const existing = RECITERS.find((r) => r.id === id);
    const record = { id, name, nameLatin: nameLatin || name, nameRu: nameRu || name };
    if (mushafEdition) record.mushafEdition = mushafEdition;
    if (surahList) record.surahList = String(surahList);
    if (moshafId != null) record.moshafId = Number(moshafId);
    if (readKind) record.readKind = String(readKind);
    if (timingReadId != null) record.timingReadId = Number(timingReadId);
    if (catalogSource) record.catalogSource = String(catalogSource);
    if (existing) Object.assign(existing, record);
    else RECITERS.push(record);
    if (normalizedServer) CUSTOM_SURAH_AUDIO[id] = (n) => `${normalizedServer}${String(n).padStart(3, '0')}.mp3`;
    else CUSTOM_SURAH_AUDIO[id] = (n) => (CUSTOM_SURAH_AUDIO_URLS[id] && CUSTOM_SURAH_AUDIO_URLS[id][Number(n)]) || '';
    if (typeof urlResolver === 'function') CUSTOM_SURAH_AUDIO_RESOLVERS[id] = urlResolver;
    return true;
  }

  // 5️⃣ رابط تلاوة صوتية للآية (افتراضيًا الشيخ مشاري العفاسي، أو أي قارئ آخر من RECITERS)
  // ملاحظة: لو القارئ من الثلاثة اللي عندهم رابط آية-بآية حقيقي في CUSTOM_AYAH_AUDIO،
  // بيرجع رابطهم على طول من غير أي طلب شبكة زيادة. غيرهم (بما فيهم هيثم الدخين اللي
  // معندوش تسجيل آية-بآية في أي مكان) بيكمل على alquran.cloud كالعادة
  async function getAyahAudio(surah, ayah, editionId) {
    const ed = editionId || 'ar.alafasy';
    if (CUSTOM_AYAH_AUDIO[ed]) return CUSTOM_AYAH_AUDIO[ed](surah, ayah);
    const data = await cachedFetchJSON(`${BASE}/ayah/${surah}:${ayah}/${ed}`, 24 * 365);
    // مهم: حقل "audio" اللي كان بيترجع من هنا رابط قديم من دومين
    // cdn.alquran.cloud من غير امتداد ملف (.mp3) خالص، وده كان بيفشل في
    // التشغيل غالبًا (بيظهر "تعذّر تشغيل الصوت") لأن الدومين ده مش هو الـCDN
    // الموثّق/المستقر حاليًا. نفس الاستجابة برضو فيها "audioSecondary" وهو
    // مصفوفة روابط من cdn.islamic.network (الـCDN الرسمي الموثّق دلوقتي،
    // ونفسه اللي بنستخدمه أصلًا لملفات السور الكاملة في getSurahAudioURL
    // فوق)، برابط .mp3 سليم وكامل. نفضّله لو موجود ونرجع للحقل القديم بس لو
    // مكانش (احتياطًا لأي نسخة قديمة من الـAPI أو قارئ نادر مفيهوش الحقل ده)
    if (Array.isArray(data.data.audioSecondary) && data.data.audioSecondary[0]) {
      return data.data.audioSecondary[0];
    }
    return data.data.audio;
  }

  // 6️⃣.٥ البحث داخل نص القرآن نفسه بكلمة معينة (وليس بأسماء السور فقط)
  // يستخدم واجهة البحث في alquran.cloud، ويعيد كل الآيات المطابقة في كامل المصحف
  async function searchQuran(keyword) {
    const kw = String(keyword || '').trim();
    if (!kw) return [];

    const cached = await IdbKVCache.get('quran-search', kw);
    if (cached && Date.now() - cached.t < 24 * 3600 * 1000) return cached.v;

    const url = `${BASE}/search/${encodeURIComponent(kw)}/all/quran-uthmani`;
    const res = await fetch(url);

    // الواجهة البرمجية ترجع 404 عند عدم وجود أي نتائج مطابقة، وهذا ليس خطأ اتصال
    if (res.status === 404) return [];
    if (!res.ok) throw new Error('تعذر الاتصال بالخادم: ' + res.status);

    const data = await res.json();
    const matches = (data.data && data.data.matches) || [];
    const results = matches.map((m) => ({
      surahNum: m.surah.number,
      surahNameAr: m.surah.name,
      ayahNum: m.numberInSurah,
      text: m.text,
      page: m.page
    }));

    await IdbKVCache.set('quran-search', kw, results);
    return results;
  }

  // 6️⃣ معاني الكلمات (تحليل كلمة كلمة) عبر quran.com
  async function getWordMeanings(surah, ayah) {
    const url = `${QCOM}/verses/by_key/${surah}:${ayah}?language=ar&words=true&word_fields=text_uthmani,translation&word_translation_language=ar`;
    const data = await cachedFetchJSON(url);
    const words = (data.verse && data.verse.words) || [];
    return words
      .filter((w) => w.char_type_name === 'word')
      .map((w) => ({
        text: w.text_uthmani || w.text,
        meaning: (w.translation && w.translation.text) || ''
      }));
  }

  // Word-by-word Uthmani text for live tasmee. Fetch only the Quran.com
  // chapter pages intersecting the requested range and retain verse numbers.
  async function getAyahWordRange(surahNumber, fromAyah, toAyah) {
    const firstPage = Math.floor((fromAyah - 1) / 50) + 1;
    const lastPage = Math.floor((toAyah - 1) / 50) + 1;
    const byAyah = new Map();
    for (let page = firstPage; page <= lastPage; page++) {
      const url = `${QCOM}/verses/by_chapter/${surahNumber}?language=ar&words=true&word_fields=text_uthmani,position,line_number,char_type_name&fields=text_uthmani&page=${page}&per_page=50`;
      const data = await cachedFetchJSON(url, 24 * 365);
      (data.verses || []).forEach((verse) => {
        const number = Number(verse.verse_number || String(verse.verse_key || '').split(':')[1]);
        if (number < fromAyah || number > toAyah) return;
        const wordItems = (verse.words || [])
          .filter((word) => word.char_type_name === 'word')
          .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
          .map((word) => ({
            text: String(word.text_uthmani || word.text || '').trim(),
            lineNumber: Number(word.line_number) || null,
            position: Number(word.position) || null
          }))
          .filter((word) => word.text);
        if (wordItems.length) byAyah.set(number, {
          numberInSurah: number,
          text: String(verse.text_uthmani || wordItems.map((word) => word.text).join(' ')),
          words: wordItems.map((word) => word.text),
          wordLayout: wordItems,
          page: Number(verse.page_number) || null
        });
      });
    }
    const result = [];
    for (let ayah = fromAyah; ayah <= toAyah; ayah++) {
      let item = byAyah.get(ayah);
      // The chapter endpoint may omit words for a verse; use the API's
      // verse endpoint as a targeted fallback rather than splitting text.
      if (!item) {
        const url = `${QCOM}/verses/by_key/${surahNumber}:${ayah}?language=ar&words=true&word_fields=text_uthmani,position,line_number,char_type_name&fields=text_uthmani`;
        const data = await cachedFetchJSON(url, 24 * 365);
        const verse = data.verse || {};
        const wordItems = (verse.words || [])
          .filter((word) => word.char_type_name === 'word')
          .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
          .map((word) => ({ text: String(word.text_uthmani || word.text || '').trim(), lineNumber: Number(word.line_number) || null, position: Number(word.position) || null }))
          .filter((word) => word.text);
        if (wordItems.length) item = { numberInSurah: ayah, text: verse.text_uthmani || wordItems.map((word) => word.text).join(' '), words: wordItems.map((word) => word.text), wordLayout: wordItems, page: Number(verse.page_number) || null };
      }
      if (item) result.push(item);
    }
    if (result.length !== toAyah - fromAyah + 1) throw new Error('Incomplete Quran word range');
    return result;
  }

  // تنظيف أي وسوم HTML (وبقايا تصدير من Word مثل مستندات .doc قديمة) من نص خام
  // قبل عرضه كنص عادي — يُستخدم مع كل محتوى نصّي قادم من الموسوعة القرآنية
  function stripHTML(raw) {
    return String(raw || '')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // فهرس (سورة → كتب متاحة لها) من الموسوعة القرآنية (Quranpedia)، يُبنى ديناميكيًا
  // ويُخزَّن لمدة سنة، بدل الاعتماد على أرقام كتب مثبّتة يدويًا قد لا تكون هي نفسها
  // مفهرسة آية بآية فعليًا (كتب كتير على الموسوعة عبارة عن ملفات Word/PDF كاملة فقط
  // بلا محتوى مقسَّم لكل آية، فطلب محتواها من نقطة /ayah/.../book/{id} يرجع فاضي دايمًا
  // حتى لو رقم الكتاب صحيح ومهما كان الاتصال سليمًا). بجلب قائمة كتب السورة نفسها
  // وتصفيتها بالاسم، بنضمن إننا بنجرّب كتب موجودة فعلًا مرتبطة بهذه السورة تحديدًا
  async function getSurahBooks(surahNumber) {
    const url = `https://api.quranpedia.net/v1/surah/books/${surahNumber}`;
    try {
      const data = await cachedFetchJSON(url, 24 * 365);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }

  // يجرّب محتوى الآية من كل كتاب في قائمة مرشّحين بالترتيب، ويرجع أول نتيجة نص
  // فعلي غير فاضي (بعض الكتب مُدرَجة بالاسم لكن بلا محتوى مفهرس آية بآية)
  async function tryAyahBooks(surah, ayah, candidateBooks, fallbackName) {
    let lastErr = null;
    for (const book of candidateBooks.slice(0, 8)) {
      try {
        const url = `https://api.quranpedia.net/v1/ayah/${surah}/${ayah}/book/${book.id}`;
        const data = await cachedFetchJSON(url, 24 * 365);
        const parts = (data && data.content) || [];
        const raw = parts.map((p) => p.text || '').join('\n\n');
        const text = stripHTML(raw);
        if (!text) continue;
        const bookName = (data && data.book && data.book.name) || book.name || fallbackName;
        const authorName = (data && data.book && data.book.author && data.book.author.ar_name) || book.author;
        return { text, source: authorName ? `${bookName} — ${authorName}` : bookName };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error(`لا يوجد نص لهذه الآية في المصادر المتاحة`);
  }

  // مصدر احتياطي مشترك للإعراب والبلاغة: بدل الاعتماد فقط على قائمة كتب السورة
  // نفسها (/surah/books/{n})، اللي بعض السور مش مربوطة فيها بأي كتاب إعراب رغم
  // وجود كتب إعراب فعلية على الموسوعة (فالسبب مش عدم وجود المحتوى، لكن إن فهرسة
  // "كتب هذه السورة" عند quranpedia مش شاملة كل كتاب له علاقة بها). فبنجلب هنا
  // بالإضافة لقائمة كتب السورة، قائمة كتب التصنيف نفسه بالكامل (/categories/books
  // ثم /category/{id}/books) زي ما كان بيحصل للبلاغة بالظبط، ونضمّهم كمرشحين
  // إضافيين. النتيجة مخزَّنة سنة كاملة زي باقي كتب المصدر، فبعد أول نجاح تفتح
  // بدون إنترنت لاحقًا زي التفسير تمامًا
  const _categoryBooksCache = {};
  async function getBooksByCategoryName(nameRegex, cacheKey) {
    if (_categoryBooksCache[cacheKey]) return _categoryBooksCache[cacheKey];
    try {
      const cats = await cachedFetchJSON('https://api.quranpedia.net/v1/categories/books', 24 * 365);
      const flat = [];
      (function walk(list) {
        (list || []).forEach((c) => { flat.push(c); if (c.children) walk(c.children); });
      })(cats);
      const cat = flat.find((c) => nameRegex.test(c.name || ''));
      if (!cat) { _categoryBooksCache[cacheKey] = []; return _categoryBooksCache[cacheKey]; }
      const books = await cachedFetchJSON(`https://api.quranpedia.net/v1/category/${cat.id}/books`, 24 * 365);
      _categoryBooksCache[cacheKey] = Array.isArray(books) ? books : [];
    } catch (e) {
      _categoryBooksCache[cacheKey] = [];
    }
    return _categoryBooksCache[cacheKey];
  }

  // يدمج مرشحين من مصدرين (قائمة كتب السورة + قائمة كتب التصنيف العام) بدون
  // تكرار نفس رقم الكتاب، مع تقديم مرشحي السورة أولاً لأنهم عادة أدق ارتباطًا
  function mergeBookCandidates(surahBooks, categoryBooks, nameRegex) {
    const surahMatches = surahBooks.filter((b) => nameRegex.test(b.name || '') || nameRegex.test(b.short_name || ''));
    const seen = new Set(surahMatches.map((b) => b.id));
    const extra = categoryBooks.filter((b) => !seen.has(b.id));
    return surahMatches.concat(extra);
  }

  // قائمة كتب التفاسير المرتبطة بسورة معيّنة تحديدًا (نقطة /surah/tafsirs/
  // مختلفة عن /surah/books/ الأعم؛ بتيجي مضبوطة بكتب التفسير المفهرسة آية
  // بآية فعليًا لهذه السورة، فبنستخدمها كمصدر مرشحين إضافي أدق من /surah/books/
  // وحدها) — بتتخزّن سنة زي باقي فهارس الكتب
  const _surahTafsirsCache = {};
  async function getSurahTafsirs(surahNumber) {
    if (_surahTafsirsCache[surahNumber]) return _surahTafsirsCache[surahNumber];
    try {
      const url = `https://api.quranpedia.net/v1/surah/tafsirs/${surahNumber}`;
      const data = await cachedFetchJSON(url, 24 * 365);
      _surahTafsirsCache[surahNumber] = Array.isArray(data) ? data : [];
    } catch (e) {
      _surahTafsirsCache[surahNumber] = [];
    }
    return _surahTafsirsCache[surahNumber];
  }

  // يدمج مرشحين حسب الاسم/المؤلف (مش بس التصنيف) من كل كتب السورة (عامة
  // وتفسير)، بيتفيد بيه البلاغة وأسباب النزول لما الكتاب المطلوب يكون مصنّف
  // ضمن "التفسير" على الموسوعة مش ضمن تصنيف مستقل باسمه
  function filterBooksByNameRegex(books, nameRegex) {
    const seen = new Set();
    return books.filter((b) => {
      if (seen.has(b.id)) return false;
      const match = nameRegex.test(b.name || '') || nameRegex.test(b.short_name || '') || nameRegex.test(b.author || '');
      if (match) seen.add(b.id);
      return match;
    });
  }

  // 6️⃣.٥ إعراب الآية — عبر الموسوعة القرآنية (Quranpedia). نجرّب أولاً كتب هذه
  // السورة تحديدًا اللي اسمها فيه "إعراب"، وإن فشلوا أو مكنش فيه أي كتاب مربوط
  // بالسورة، نوسّع البحث لكل كتب تصنيف "إعراب" على الموسوعة كمصدر احتياطي —
  // فمحتوى الآية بيتلاقى حتى لو السورة مش مفهرسة صح في قائمة كتبها الخاصة
  async function getIrab(surah, ayah) {
    const [surahBooks, categoryBooks] = await Promise.all([
      getSurahBooks(surah),
      getBooksByCategoryName(/إعراب/, 'irab')
    ]);
    const candidates = mergeBookCandidates(surahBooks, categoryBooks, /إعراب/);
    if (!candidates.length) throw new Error('لا يوجد كتاب إعراب متاح لهذه الآية في المصدر المعتمد');
    return tryAyahBooks(surah, ayah, candidates, 'إعراب القرآن الكريم');
  }

  // 6️⃣.٥.٥ البلاغة — "بلاغة القرآن" مش نوع محتوى مستقل مفهرس آية بآية عند
  // الموسوعة القرآنية أصلاً (خلافًا للإعراب/أسباب النزول اللي ليهم كتب مؤلَّفة
  // خصيصًا مرتّبة بترتيب المصحف)؛ الكتب المصنَّفة تحت "بلاغة" غالبًا مؤلَّفات
  // عامة في علم البلاغة غير مقسَّمة لكل آية، فمحاولة جلب محتوى آية بعينها منها
  // كانت بتفشل دايمًا (تطابق مع ملاحظة إن البلاغة "مش شغالة على أي حاجة").
  // البديل الصحيح المتّبع عند أهل التخصص: وجه البلاغة موجود فعليًا داخل كتب
  // تفسير معيّنة اشتهرت بتوسّعها فيه لكل آية (الكشاف للزمخشري، التحرير والتنوير
  // لابن عاشور، إرشاد العقل السليم لأبي السعود، البحر المحيط لأبي حيان، روح
  // المعاني للألوسي) — وهذه كتب "تفسير" مفهرسة آية بآية بالفعل عند الموسوعة،
  // فبنجلب مرشحينا من قائمتي كتب/تفاسير هذه السورة تحديدًا ونصفّيهم بالاسم
  // على هذه المؤلفات، مع إبقاء تصنيف "بلاغة" العام كمصدر احتياطي أخير فقط
  const BALAGHA_TAFSIR_NAME_RX = /(كشاف|زمخشري|تحرير والتنوير|ابن عاشور|إرشاد العقل السليم|أبو السعود|ابو السعود|البحر المحيط|أبو حيان|ابو حيان|روح المعاني|الألوسي|الالوسي)/;
  async function getBalagha(surah, ayah) {
    const [surahTafsirs, surahBooks] = await Promise.all([
      getSurahTafsirs(surah),
      getSurahBooks(surah)
    ]);
    let candidates = filterBooksByNameRegex(surahTafsirs.concat(surahBooks), BALAGHA_TAFSIR_NAME_RX);
    if (!candidates.length) {
      // احتياطي أخير: تصنيف "بلاغة" العام، لو فيه كتاب نادر مفهرس فعليًا
      const categoryBooks = await getBooksByCategoryName(/بلاغ/, 'balagha');
      candidates = mergeBookCandidates(surahBooks, categoryBooks, /بلاغ/);
    }
    if (!candidates.length) throw new Error('لا يوجد كتاب بلاغة متاح لهذه الآية في المصدر المعتمد');
    return tryAyahBooks(surah, ayah, candidates, 'وجه البلاغة (من كتب التفسير)');
  }

  // 6️⃣.٥.٧ أسباب النزول — عبر تصنيف "أسباب النزول" على الموسوعة القرآنية
  // (Quranpedia: الواحدي، لباب النقول للسيوطي، العجاب في بيان الأسباب لابن
  // حجر العسقلاني، الصحيح المسند لمقبل بن هادي الوادعي، المحرر لخالد المزيني،
  // وغيرهم)، بالإضافة لمطابقة أسماء هذه الكتب/المؤلفين بعينها داخل قوائم كتب
  // هذه السورة مباشرة (احتياطي إضافي لو تصنيف الموسوعة نفسه ما كانش شاملاً كل
  // كتاب مرتبط بالسورة). بيغطي هذا مجتمعًا كل الآيات المفهرسة فعليًا عند
  // الموسوعة، مش بس القائمة المختصرة المحلية في asbab-data.js (اللي بتفضل
  // شغالة كمصدر احتياطي أخير في app.js لو الـ API فشل أو مفيش إنترنت)
  const ASBAB_BOOK_NAME_RX = /(أسباب النزول|لباب النقول|العجاب في بيان الأسباب|الصحيح المسند من أسباب النزول|المحرر في أسباب النزول|الواحدي|لباب النقول|ابن حجر العسقلاني|مقبل.*الوادعي|خالد المزيني)/;
  async function getAsbabNuzul(surah, ayah) {
    const [surahBooks, categoryBooks] = await Promise.all([
      getSurahBooks(surah),
      getBooksByCategoryName(/(أسباب.*النزول|سبب.*النزول)/, 'asbab')
    ]);
    const categoryMatches = mergeBookCandidates(surahBooks, categoryBooks, /(أسباب.*النزول|سبب.*النزول)/);
    const nameMatches = filterBooksByNameRegex(surahBooks, ASBAB_BOOK_NAME_RX);
    const seen = new Set(categoryMatches.map((b) => b.id));
    const candidates = categoryMatches.concat(nameMatches.filter((b) => !seen.has(b.id)));
    if (!candidates.length) throw new Error('لا يوجد كتاب أسباب نزول متاح لهذه الآية في المصدر المعتمد');
    return tryAyahBooks(surah, ayah, candidates, 'أسباب النزول');
  }

  // 6️⃣.٥.٨ توجيه المتشابهات اللفظية — الفرق ده مهم: getMutashabihat() فوق
  // بيرجّع قائمة آيات تانية فيها نفس العبارة تقريبًا (بحث نصي حرفي مباشر، مفيد
  // لسرعة إيجاد الآيات المتشابهة نفسها)، لكن ده مختلف تمامًا عن "توجيه" العلماء
  // لسبب التشابه/الاختلاف بينها (ليه هنا "قالوا" وهناك "قال"، ليه هنا "الأرض
  // والسماوات" وهناك "السماوات والأرض"...). التوجيه ده علم مستقل ليه كتب
  // مؤلَّفة خصيصًا مرتّبة على ترتيب المصحف (ملاك التأويل لابن الزبير الغرناطي،
  // درة التنزيل وغرة التأويل للخطيب الإسكافي، البرهان في توجيه متشابه القرآن
  // للكرماني)، فبنجيبها بنفس آلية أسباب النزول: تصنيف الموسوعة + مطابقة اسم
  // الكتاب/المؤلف كاحتياط. ملحوظة: مش كل آية متشابهة لها توجيه مأثور مسجَّل،
  // فرجوع "لا يوجد" هنا أمر متوقّع وطبيعي وليس عطلاً
  const MUTASHABIHAT_BOOK_NAME_RX = /(ملاك التأويل|ابن الزبير الغرناطي|درة التنزيل|الخطيب الإسكافي|البرهان في توجيه متشابه القرآن|الكرماني|أسرار التكرار)/;
  async function getMutashabihatTawjeeh(surah, ayah) {
    const [surahBooks, categoryBooks] = await Promise.all([
      getSurahBooks(surah),
      getBooksByCategoryName(/متشابه/, 'mutashabihat')
    ]);
    const categoryMatches = mergeBookCandidates(surahBooks, categoryBooks, /متشابه/);
    const nameMatches = filterBooksByNameRegex(surahBooks, MUTASHABIHAT_BOOK_NAME_RX);
    const seen = new Set(categoryMatches.map((b) => b.id));
    const candidates = categoryMatches.concat(nameMatches.filter((b) => !seen.has(b.id)));
    if (!candidates.length) throw new Error('لا يوجد كتاب توجيه متشابهات متاح لهذه الآية في المصدر المعتمد');
    return tryAyahBooks(surah, ayah, candidates, 'توجيه المتشابهات');
  }


  // 6️⃣.٦ الصرف (تحليل صرفي لكل كلمة: الجذر والأصل) — من نسخة محلية مُجمَّعة
  // مسبقًا داخل التطبيق نفسه (مبنية من مدوّنة القرآن الصرفية المفتوحة)، بدل
  // الاعتماد على نقطة اتصال خارجية حيّة في كل مرة (quran.com انتقلت لواجهة
  // تحتاج مصادقة OAuth لخوادمها، فطلبات المتصفح المباشرة لها لم تعد مضمونة).
  // بهذا يعمل الصرف فورًا وبدون إنترنت أيضًا، ومضمون العمل دائمًا لأنه جزء
  // من ملفات التطبيق نفسها ولا يعتمد على أي خادم خارجي على الإطلاق
  const _sarfSurahCache = {};
  async function getWordMorphology(surah, ayah) {
    if (!_sarfSurahCache[surah]) {
      const res = await fetch(`sarf/${surah}.json`);
      if (!res.ok) throw new Error('تعذر تحميل بيانات الصرف لهذه السورة: ' + res.status);
      _sarfSurahCache[surah] = await res.json();
    }
    const words = _sarfSurahCache[surah][String(ayah)] || [];
    return words.map(([text, root, lemma]) => ({ text, root: root || '', lemma: lemma || '' }));
  }

  // 6️⃣.٦.٥ بحث "بالمعنى" (بنفس الجذر اللغوي) — بحث النص العادي (searchQuran)
  // بيدوّر بس على نفس الحروف بالظبط، فمثلاً كتابة "صبر" بترجّع الآيات اللي فيها
  // كلمة "صبر" حرفيًا بس، مش "اصبروا" أو "صابرين" أو "تصبروا" مع إنها كلها من
  // نفس المعنى والجذر. البحث ده بيحل المشكلة دي بالكامل من غير إنترنت، لأنه
  // مبني على نفس ملفات الصرف المحلية في www/sarf (موجودة أصلاً في التطبيق لعرض
  // تبويب "صرف" لكل آية) واللي فيها لكل كلمة: [النص كما في المصحف، الجذر، الأصل].
  // أول استخدام بيحمّل الـ ١١٤ ملف (حوالي ٣ ميجا) مرة واحدة ويبني فهرس عكسي
  // (جذر → كل الآيات) في الذاكرة، وبعد كده كل بحث تالٍ فوري بدون أي تحميل إضافي.
  let _rootIndexPromise = null;
  const ROOT_SEARCH_TASHKEEL = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED\u0640]/g;
  function normalizeForMeaningSearch(str) {
    return String(str)
      .replace(ROOT_SEARCH_TASHKEEL, '')
      .replace(/[إأآٱا]/g, 'ا') // توحيد أشكال الألف والهمزة عليها
      .replace(/ة/g, 'ه')       // توحيد التاء المربوطة بالهاء
      .replace(/ى/g, 'ي')       // توحيد الألف المقصورة بالياء
      .trim();
  }

  // سوابق ولواحق عربية شائعة (أدوات تعريف/عطف/جر وضمائر متصلة وعلامات جمع)
  // بنستخدمها في تفكيك أي كلمة مكتوبة لتقريبها من جذرها، عشان البحث يشتغل
  // مع أي تصريف يكتبه المستخدم مش بس اللي يطابق حروف الآية بالظبط.
  // مرتّبة من الأطول للأقصر عشان نجرّب أدق تطابق الأول
  const MEANING_PREFIXES = ['بالأ', 'والأ', 'فالأ', 'كالأ', 'لل', 'بال', 'كال', 'فال', 'وال', 'ال', 'و', 'ف', 'ب', 'ك', 'ل', 'س', 'ت', 'ي', 'ن', 'أ']
    .sort((a, b) => b.length - a.length);
  const MEANING_SUFFIXES = ['كموها', 'تموها', 'وهما', 'اهما', 'هما', 'كما', 'تما', 'ونا', 'اتي', 'ات', 'ون', 'ين', 'ان', 'ها', 'هم', 'هن', 'كم', 'كن', 'تم', 'تن', 'نا', 'وا', 'ية', 'تا', 'ة', 'ه', 'ي', 'ن', 'ا', 'و', 'ت']
    .sort((a, b) => b.length - a.length);

  function stripAffixList(word, list, fromStart) {
    const outs = [];
    list.forEach((a) => {
      if (fromStart ? word.startsWith(a) : word.endsWith(a)) {
        const rest = fromStart ? word.slice(a.length) : word.slice(0, word.length - a.length);
        if (rest.length >= 2) outs.push(rest);
      }
    });
    return outs;
  }

  // بيرجّع كل الأشكال المحتملة لجذع الكلمة: الكلمة نفسها، وبعد حذف سابقة
  // معروفة، وبعد حذف لاحقة معروفة من كل شكل سابق — عشان نغطي كلمة زي
  // "والصابرين" (سابقة + لاحقة مع بعض) مش بس حالة واحدة بسيطة
  function getMeaningStemCandidates(kw) {
    const candidates = new Set([kw]);
    const afterPrefix = stripAffixList(kw, MEANING_PREFIXES, true);
    afterPrefix.forEach((w) => candidates.add(w));
    [kw, ...afterPrefix].forEach((w) => {
      stripAffixList(w, MEANING_SUFFIXES, false).forEach((w2) => candidates.add(w2));
    });
    return Array.from(candidates);
  }

  async function buildMeaningSearchIndex() {
    if (_rootIndexPromise) return _rootIndexPromise;
    _rootIndexPromise = (async () => {
      const wordToRoots = new Map();   // كلمة سطحية موحّدة → مجموعة الجذور اللي وردت بيها
      const rootToAyahs = new Map();   // جذر → مجموعة مفاتيح الآيات "سورة:آية"
      const ayahWords = new Map();     // "سورة:آية" → نص الآية كاملاً (معاد بناؤه من كلمات الصرف)
      const rootAyahWords = new Map(); // جذر → مفتاح الآية → مجموعة الكلمات (بالتشكيل) المطابقة، لتظليلها في النتيجة
      const normRootIndex = new Map(); // جذر موحّد (بدون همزات/تشكيل) → مجموعة الجذور الأصلية المطابقة له

      for (let s = 1; s <= 114; s++) {
        let data = _sarfSurahCache[s];
        if (!data) {
          try {
            const res = await fetch(`sarf/${s}.json`);
            if (!res.ok) continue;
            data = await res.json();
            _sarfSurahCache[s] = data;
          } catch (e) { continue; }
        }
        Object.keys(data).forEach((ayahNum) => {
          const words = data[ayahNum];
          const key = `${s}:${ayahNum}`;
          ayahWords.set(key, words.map((w) => w[0]).join(' '));
          words.forEach(([text, root]) => {
            if (!root) return;
            const norm = normalizeForMeaningSearch(text);
            if (!wordToRoots.has(norm)) wordToRoots.set(norm, new Set());
            wordToRoots.get(norm).add(root);

            const normRoot = normalizeForMeaningSearch(root);
            if (!normRootIndex.has(normRoot)) normRootIndex.set(normRoot, new Set());
            normRootIndex.get(normRoot).add(root);

            if (!rootToAyahs.has(root)) rootToAyahs.set(root, new Set());
            rootToAyahs.get(root).add(key);

            if (!rootAyahWords.has(root)) rootAyahWords.set(root, new Map());
            const perAyah = rootAyahWords.get(root);
            if (!perAyah.has(key)) perAyah.set(key, new Set());
            perAyah.get(key).add(text);
          });
        });
      }

      return { wordToRoots, rootToAyahs, ayahWords, rootAyahWords, normRootIndex };
    })();
    return _rootIndexPromise;
  }

  async function searchByMeaning(keyword) {
    const kw = normalizeForMeaningSearch(String(keyword || ''));
    if (kw.length < 2) return [];

    const { wordToRoots, rootToAyahs, ayahWords, rootAyahWords, normRootIndex } = await buildMeaningSearchIndex();

    // كل الأشكال المحتملة لجذع الكلمة المكتوبة (هي نفسها + بعد تجريدها من
    // سوابق/لواحق شائعة زي "ال، و، ف، ب... / ون، ين، ات، ها...")، عشان
    // البحث يمسك أي تصريف يكتبه المستخدم مش بس اللي يطابق الجذر بالظبط
    const stemCandidates = getMeaningStemCandidates(kw);

    const roots = new Set();

    // ١) لو أي شكل من أشكال الكلمة المكتوبة (أو جذعها) بيطابق جذرًا معروفًا
    //    بالظبط (زي "صبر"، "رحم"، "علم"، أو "امن" اللي جذرها الأصلي "أمن")
    stemCandidates.forEach((cand) => {
      const known = normRootIndex.get(cand);
      if (known) known.forEach((r) => roots.add(r));
    });

    // ٢) كمان هات كل الكلمات اللي بتحتوي على الكلمة المكتوبة (أو جذعها بعد
    //    تجريد السوابق/اللواحق) واجمع جذورها — بيغطي أي تصريف تاني حتى لو
    //    جذعه المجرّد مش مطابق بالظبط لجذر معروف. بنتجاهل الجذوع القصيرة جدًا
    //    (أقل من ٣ حروف) هنا عشان منجيبش نتايج كتير مالهاش علاقة بالمكتوب
    stemCandidates.filter((c) => c.length >= 3 || c === kw).forEach((cand) => {
      wordToRoots.forEach((wordRoots, word) => {
        if (word.includes(cand)) wordRoots.forEach((r) => roots.add(r));
      });
    });

    if (!roots.size) return [];

    const seen = new Map(); // مفتاح الآية → { root, matchedWords: Set }
    roots.forEach((root) => {
      const ayahKeys = rootToAyahs.get(root);
      if (!ayahKeys) return;
      const perAyahWords = rootAyahWords.get(root);
      ayahKeys.forEach((key) => {
        if (!seen.has(key)) seen.set(key, { root, matchedWords: new Set() });
        const entry = seen.get(key);
        const wordsForThisAyah = (perAyahWords && perAyahWords.get(key)) || new Set();
        wordsForThisAyah.forEach((w) => entry.matchedWords.add(w));
      });
    });

    const results = Array.from(seen.entries()).map(([key, info]) => {
      const [s, a] = key.split(':').map(Number);
      return {
        surahNum: s,
        ayahNum: a,
        text: ayahWords.get(key) || '',
        root: info.root,
        matchedWords: Array.from(info.matchedWords)
      };
    });

    results.sort((x, y) => (x.surahNum - y.surahNum) || (x.ayahNum - y.ayahNum));

    const surahs = await getSurahList();
    const surahMap = new Map(surahs.map((sur) => [sur.number, sur]));
    results.forEach((r) => { r.surahNameAr = (surahMap.get(r.surahNum) || {}).nameAr || ''; });

    return results;
  }

  // 6️⃣.٧ جلايف عنوان السورة كما يظهر بالضبط في رسم مصحف المدينة (خط QCF4) —
  // تُستخدم لعرض اسم السورة بنفس شكله الزخرفي المطبوع في المصحف عند توليد
  // صورة مشاركة الآية، بدل كتابته كنص عادي. نجلب صفحة بداية السورة من رسم
  // QCF4 (getPageQCF4) ونلقط عنصر عنوان السورة (type: "surah_header") الذي
  // يسبق مباشرة أول كلمة من الآية الأولى لهذه السورة تحديدًا (حتى لا نخطئ
  // ونلتقط عنوان سورة أخرى لو الصفحة تجمع أكثر من سورة قصيرة)
  async function getSurahHeaderGlyph(surahNumber) {
    const page = await getSurahStartPage(surahNumber);
    const qcfData = await getPageQCF4(page);
    const lines = (qcfData && qcfData.lines) || [];
    let lastHeader = null;
    for (const line of lines) {
      for (const w of (line.words || [])) {
        if (w.type === 'surah_header') {
          lastHeader = w;
        } else if (w.type === 'word' && w.verse_key === `${surahNumber}:1`) {
          return lastHeader;
        }
      }
    }
    return null;
  }

  // 6️⃣.٨ كلمات رسم QCF4 (بخط مصحف المدينة الأصلي) لنطاق آيات معيّن داخل
  // سورة واحدة، بترتيب القراءة الصحيح — تُستخدم لكتابة نص الآيات في صورة
  // المشاركة بنفس خط طبعة المصحف الحقيقي (مش تقريب بخط عادي). تجلب كل
  // الصفحات التي يمتد عليها النطاق (غالبًا صفحة واحدة أو اثنتين) وتلتقط
  // فقط كلمات النطاق المطلوب (بما فيها علامات نهاية الآية الزخرفية،
  // فهي حرف عادي داخل نفس الخط أصلًا — انظر تعليق renderPageContentQCF4)
  async function getQCF4WordsForRange(surahNumber, fromAyah, toAyah) {
    const startPage = await getAyahPage(surahNumber, fromAyah);
    const endPage = await getAyahPage(surahNumber, toAyah);
    if (!startPage || !endPage) return [];
    const words = [];
    for (let p = startPage; p <= endPage; p++) {
      const qcfData = await getPageQCF4(p);
      (qcfData.lines || []).forEach((line) => {
        (line.words || []).forEach((w) => {
          if (w.type !== 'word' && w.type !== 'end') return;
          const vk = w.verse_key;
          if (!vk) return;
          const parts = vk.split(':');
          const s = Number(parts[0]);
          const a = Number(parts[1]);
          if (s === surahNumber && a >= fromAyah && a <= toAyah) {
            words.push({ char: w.char, font: w.font, isEnd: w.type === 'end' });
          }
        });
      });
    }
    return words;
  }

  // 7️⃣ صفحة برسم مصحف المدينة الأصلي (خط مجمع الملك فهد QCF4)، تُستخدم في وضع
  // "طبق الأصل" — بيانات مفتوحة المصدر تعطي تقسيم الأسطر والكلمات المطابق تمامًا
  // لطبعة مجمع الملك فهد بالمدينة المنورة (بدون أي اتصال بخوادمنا الخاصة)
  async function getPageQCF4(pageNumber) {
    const p = String(pageNumber).padStart(3, '0');
    try {
      const bundledUrl = new URL(`quran-data/qcf4/pages/${p}.json`, document.baseURI);
      const response = await fetch(bundledUrl);
      if (response.ok) return await response.json();
    } catch (e) { /* older web deployments fall back to the existing cache/API */ }
    // نسخ الويب الأقدم التي لا تحتوي الأصول المحلية تستخدم التخزين والشبكة
    // كحل احتياطي؛ الإصدارات الحالية تحمل كل الصفحات مع التطبيق.
    const remoteUrl = `https://raw.githubusercontent.com/Ziad-Alkamash/quran-qcf4/main/pages/${p}.json`;
    if (window.QuranOffline && window.QuranOffline.isNativeReady && window.QuranOffline.isNativeReady()) {
      try {
        return await window.QuranOffline.cacheFetchJSON(remoteUrl, `Quran/qcf4/pages/${p}.json`);
      } catch (e) { /* نتابع للتخزين المؤقت العادي أدناه كحل أخير */ }
    }
    return cachedFetchJSON(remoteUrl, 24 * 365);
  }

  return { 
    getPage, 
    getPageQCF4,
    getSurahList, 
    getSurahStartPage, 
    getAyahRange,
    getAyahPage,
    getSurahAyahLengths,
    getTafsir,
    getTafsirEditions,
    getTafsirSurah,
    downloadTafsirEdition,
    cancelTafsirDownload,
    isTafsirEditionDownloaded,
    getAyahAudio, 
    getWordMeanings,
    getAyahWordRange,
    getIrab,
    getBalagha,
    getAsbabNuzul,
    getMutashabihatTawjeeh,
    getWordMorphology,
    getTranslationEn,
    getMutashabihat,
    getSurahHeaderGlyph,
    getQCF4WordsForRange,
    searchQuran,
    searchByMeaning,
    pageURL,
    RECITERS,
    registerCustomSurahReciter,
    getSurahAudioURL,
    setCustomSurahAudioURL,
    ensureCustomSurahAudioURL,
    isCustomAudioReciter,
    hasRealAyahAudio,
    hasEveryAyahAudio,
    recordSurahStartPagesFromRawPage,
    getHizbQuarterIndex
  };
})();

// يستهلك فهرس MP3Quran هذا الـAPI من ملف مستقل؛ const العام لا يظهر كخاصية
// على window في المتصفحات، لذلك نكشف نفس الكائن صراحةً للملفات الأخرى.
if (typeof window !== 'undefined') window.QuranAPI = QuranAPI;
