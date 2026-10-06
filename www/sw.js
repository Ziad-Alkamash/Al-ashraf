// مهم: أي تعديل في أي ملف من ASSETS_TO_CACHE (خصوصًا app.js) لازم يتصاحب
// بزيادة رقم النسخة هنا. الـ Service Worker شغّال بطريقة "الكاش أولاً"
// (caches.match قبل ما يحاول الشبكة أصلًا)، فلو الاسم فضل زي ما هو، التطبيق
// هيفضل يقرأ الملفات القديمة المخزّنة من أول تثبيت للأبد ومش هياخد بال
// بأي تعديل جديد حتى لو الملف اتغيّر فعليًا على السيرفر/داخل الـ APK،
// إلا لو المستخدم مسح بيانات التطبيق يدويًا. تغيير الاسم هنا هو الطريقة
// الوحيدة اللي بتخلي event 'activate' يمسح الكاش القديم (v301) ويجبر
// 'install' يجيب كل الملفات من جديد بمحتواها المحدَّث
const CACHE_NAME = 'mushaf-ashraf-v673';

// طبقة تخزين منفصلة لبيانات القرآن المجلوبة من الإنترنت (صفحات المصحف، التفسير، الصوتيات، معاني الكلمات)
// تبقى هذه البيانات محفوظة دائمًا حتى بعد تحديث التطبيق، ولا تُمسح إلا يدويًا من إعدادات المتصفح
const API_CACHE_NAME = 'mushaf-ashraf-quran-data-v1';
const API_HOSTS = ['api.alquran.cloud', 'api.quran.com', 'api.quranpedia.net', 'raw.githubusercontent.com', 'cdn.jsdelivr.net', 'cdn.quran.ws'];

// كاش السور المسموعة المُحمَّلة بالكامل (يُنشأ ويُدار مباشرة من app.js وليس من هنا)،
// لازم يفضل مُستثنى من تنظيف activate تحت زي API_CACHE_NAME، وإلا هيتمسح مع كل تحديث للتطبيق
const AUDIO_CACHE_NAME = 'mushaf-ashraf-audio-v1';

// الملفات اللي هيتم حفظها للعمل بدون إنترنت
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './splash-mark.webp',
  './splash-night.mp4',
  './splash-light.mp4',
  './style.css',
  './apk-update.css',
  './apk-update-core.js',
  './apk-update.js',
  './i18n.js',
  './prayer-page.css',
  './images/headphones.png',
  './images/mosque-prayer-times.png',
  './unified-theme-pages.css',
  './images/audio/hero-quran.webp',
  './images/home/memorization-quran.png',
  './images/home/memorization-icon.png',
  './images/home/memorization-mosque.png',
  './images/khatma/quran-rehal.png',
  './images/zakat.webp',
  './images/qadaa.svg',
  './images/stats.webp',
  './images/mosque.webp',
  './images/tasbih.webp',
  './images/qibla.webp',
  './net-status.js',
  './app.js',
  './location-resolver.js',
  './tafsir-books.js',
  './hadith-search-api.js',
  './sunnah-features-data.js',
  './hadith-sunnah-api.js',
  './images/sunnah/makkah.svg',
  './images/sunnah/hira.svg',
  './images/sunnah/caravan.svg',
  './images/sunnah/journey.svg',
  './images/sunnah/lamp.svg',
  './images/sunnah/night.svg',
  './images/sunnah/mountain.svg',
  './images/sunnah/treaty.svg',
  './images/sunnah/sunrise.svg',
  './images/sunnah/kaaba.svg',
  './images/sunnah/madinah.svg',
  './images/sunnah/arafah.svg',
  './khatma-group.js',
  './khatma-group.css',
  './quran-api.js',
  './quran-audio-timing.js',
  './quran-warsh.js',
  './quran-riwayat.js',
  './vendor/leaflet/leaflet.js',
  './vendor/leaflet/leaflet.css',
  './vendor/leaflet/images/marker-icon.png',
  './vendor/leaflet/images/marker-icon-2x.png',
  './vendor/leaflet/images/marker-shadow.png',
  './vendor/leaflet/images/layers.png',
  './vendor/leaflet/images/layers-2x.png',
  './azkar-data.js',
  './duas-data.js',
  './nawawi-data.js',
  './asbab-data.js',
  './mushaf-logo.png',
  './logos/saudi.png',
  './logos/madinah-sunnah.png',
  './logos/cairo.png',
  './logos/sharjah.png',
  './logos/ruqyah.png',
  './icon-192.png',
  './icon-512.png',
  './notif-icon-192.png',
  './notif-icon-512.png',
  './notif-badge-96.png',
  './notify.mp3',
  './salawat.mp3',
  // صور القراء المحلية حتى تظل متاحة بعد التثبيت ودون اتصال.
  './images/reciters/index.json',
  './images/reciters/ahmed alhawashy.jpg',
  './images/reciters/ahmed alhuzaify.jpg',
  './images/reciters/ahmed khedr.jpg',
  './images/reciters/ar.abdulbasitmjwd.jpg',
  './images/reciters/ar.abdulbasitmurattal.jpg',
  './images/reciters/ar.abdullahbasfar.jpg',
  './images/reciters/ar.abdurrahmaansudais.jpg',
  './images/reciters/ar.ahmedajamy.jpg',
  './images/reciters/ar.alafasy.jpg',
  './images/reciters/ar.alijaber.jpg',
  './images/reciters/ar.badralturki.jpg',
  './images/reciters/ar.bannamjwd.jpg',
  './images/reciters/ar.faresabbad.jpg',
  './images/reciters/ar.haithamaldukhain.jpg',
  './images/reciters/ar.hudhaify.jpg',
  './images/reciters/ar.husary.jpg',
  './images/reciters/ar.husarymjwd.jpg',
  './images/reciters/ar.islamsobhi.jpg',
  './images/reciters/ar.mahermuaiqly.jpg',
  './images/reciters/ar.mahmoudalialbanna.jpg',
  './images/reciters/ar.minshawi.jpg',
  './images/reciters/ar.minshawimjwd.jpg',
  './images/reciters/ar.mohamedtablawi.jpg',
  './images/reciters/ar.muhammadayyoub.jpg',
  './images/reciters/ar.muhammadjibreel.jpg',
  './images/reciters/ar.mustafaismail.jpg',
  './images/reciters/ar.nasseralqatami.jpg',
  './images/reciters/ar.saadalghamdi.jpg',
  './images/reciters/ar.saoodshuraym.jpg',
  './images/reciters/ar.shaatree.jpg',
  './images/reciters/ar.tablawimjwd.jpg',
  './images/reciters/ar.yasseraldosari.jpg',
  './images/reciters/ibrahim alakhdar.jpg',
  './images/reciters/ibrahim alesiry.jpg',
  './images/reciters/ibrahim algbrin.jpg',
  './images/reciters/ibrahim elsadan.jpg',
  './images/reciters/ibrahim-al-dosari.jpg',
  './images/reciters/ibrahim-al-shahri.jpg',
  './images/reciters/ibrahim-aljarmi.avif',
  './images/reciters/ibt.bahtimy.jpg',
  './images/reciters/ibt.feshni.jpg',
  './images/reciters/ibt.naqshabandi.jpg',
  './images/reciters/ibt.omran.jpg',
  './images/reciters/ibt.tobar.jpg',
  './images/reciters/qalun.dokali.jpg',
  './images/reciters/qalun.qeniwa.jpg',
  './images/reciters/qalun.tarabulsi.jpg',
  './images/reciters/quranpro-noreen-mohamed-siddiq.jpg',
  './images/reciters/quranpro-omar-al-darweez.png',
  './images/reciters/salah-al-budair.jpg',
  './images/reciters/soundcloud-hamza-boudib.jpg',
  './images/reciters/soundcloud-muhammad-dibirov.jpg',
  './images/reciters/susi.soufi.jpg',
  './images/reciters/susi.soufi.svg',
  './images/reciters/tvquran-abdullah-aljuhani.jpg',
  './images/reciters/tvquran-abdullah-kamel.jpg',
  './images/reciters/tvquran-ahmed-alnafees.jpg',
  './images/reciters/tvquran-ahmed-naeena.jpg',
  './images/reciters/tvquran-bandar-balilah.jpg',
  './images/reciters/tvquran-hassan-saleh.jpg',
  './images/reciters/tvquran-hazza-albalushi.jpg',
  './images/reciters/tvquran-khaled-almuhanna.jpg',
  './images/reciters/tvquran-mansour-al-salmi.jpg',
  './images/reciters/tvquran-mohammad-albarrak.jpg',
  './images/reciters/tvquran-raad-al-kurdi.jpg',
  './images/reciters/tvquran-salah-bu-khater.jpg',
  './images/reciters/tvquran-sayed-saeed.jpg',
  './images/reciters/tvquran-tawfiq-alsayegh.jpg',
  './images/reciters/tvquran-wadie-al-yamani.jpg',
  './images/reciters/tvquran-yasser-salama.jpg',
  './images/reciters/warsh.ibrahimdosari.jpg',
  './images/reciters/warsh.koshi.jpg',
  './images/reciters/warsh.omaralqazabri.jpg',
  './images/reciters/way2quran-ahmed-abdelrazek-nasr.jpg',
  './images/reciters/way2quran-mustafa-al-lahouni.jpg',
  './images/reciters/way2quran-saleh-al-ansari.jpg',
  './images/reciters/way2quran-yassin-al-jazairi.jpg',
  './images/reciters/way2quran-younes-aswiles.jpg',
  './images/reciters/أحمد السويلم.webp',
  './images/reciters/أحمد الطرابلسي.jpg',
  './images/reciters/أحمد خليل شاهين.jpg',
  './images/reciters/أحمد ديبان.jpg',
  './images/reciters/أحمد صابر.jpg',
  './images/reciters/أحمد عامر.jpg',
  './images/reciters/أحمد عيسى المعصراوي.webp',
  './images/reciters/أكرم العلاقمي.jpg',
  './images/reciters/أنس العمادي.jpg',
  './images/reciters/إدريس أبكر.png',
  './images/reciters/الحسيني العزازي.jpg',
  './images/reciters/الزين محمد احمد.webp',
  './images/reciters/بيشه وا قادر الكردي.jpg',
  './images/reciters/جمال شاكر عبد الله.webp',
  './images/reciters/جمعان العصيمي.jpg',
  './images/reciters/حاتم فريد الواعر.webp',
  './images/reciters/حسن الدغريري.webp',
  './images/reciters/خالد الجليل.jpg',
  './images/reciters/خالد الزيادي.webp',
  './images/reciters/خالد القحطاني.webp',
  './images/reciters/خالد عبد الكافي.webp',
  './images/reciters/خليفة الطنيجي.webp',
  './images/reciters/داود حمزة.webp',
  './images/reciters/زكي داغستاني.jpg',
  './images/reciters/سلمان الصديق.webp',
  './images/reciters/سهل ياسين.png',
  './images/reciters/سيد أحمد هاشمي.jpg',
  './images/reciters/شيرزاد عبدالرحمن طاهر.webp',
  './images/reciters/صابر عبد الحكم.jpg',
  './images/reciters/صالح الصاهود.webp',
  './images/reciters/صالح القريشي.jpg',
  './images/reciters/صالح الهبدان.webp',
  './images/reciters/صلاح الهاشم.jpg',
  './images/reciters/عادل الكلباني.jpg',
  './images/reciters/عادل ريان.jpg',
  './images/reciters/عاصم اللحيدان.webp',
  './images/reciters/عبد الإله بن عون.jpg',
  './images/reciters/عبد الباري الثبيتي.jpg',
  './images/reciters/عبد الباسط عبد الصمد.png',
  './images/reciters/عبد البديع غيلان.jpg',
  './images/reciters/عبد الرحمن العوسي.jpg',
  './images/reciters/عبد الرشيد صوفي.jpg',
  './images/reciters/عبد العزيز الأحمد.jpg',
  './images/reciters/عبد العزيز الزهراني.jpg',
  './images/reciters/عبد الله القرافي.jpg',
  './images/reciters/عبد الله المطرود.jpg',
  './images/reciters/عبد الله الموسى.jpg',
  './images/reciters/عبد الله خلف.jpg',
  './images/reciters/عبد الله خياط.jpg',
  './images/reciters/عبد المحسن الحارثي.jpg',
  './images/reciters/عبد المحسن القاسم.webp',
  './images/reciters/عبد الهادي احمد كناكري.jpg',
  './images/reciters/عبد الودود حنيف.png',
  './images/reciters/عبدالرحمن الشحات.webp',
  './images/reciters/عبدالرحمن الماجد.jpg',
  './images/reciters/عبدالرحمن عبدالرزاق البدر.jpg',
  './images/reciters/عبدالله البعيجان.webp',
  './images/reciters/عبدالله غيلان.jpg',
  './images/reciters/عبدالمحسن العبيكان.jpg',
  './images/reciters/عبدالولي الأركاني.jpg',
  './images/reciters/علي الحذيفي.jpg',
  './images/reciters/علي حجاج السويسي.webp',
  './images/reciters/عماد زهير حافظ.jpg',
  './images/reciters/عمر أحمد الدريويز.jpg',
  './images/reciters/عيسى عمر سناكو.jpg',
  './images/reciters/فيصل الهاجري.jpg',
  './images/reciters/ماجد الزامل.jpg',
  './images/reciters/مال الله عبدالرحمن الجابر.jpg',
  './images/reciters/ماهر شخاشيرو.jpg',
  './images/reciters/محمد البخيت.jpg',
  './images/reciters/محمد الفقيه.jpg',
  './images/reciters/محمد اللحيدان.webp',
  './images/reciters/محمد المحيسني.webp',
  './images/reciters/محمد برهجي.webp',
  './images/reciters/محمد خليل القارئ.webp',
  './images/reciters/محمد رشاد الشريف.jpg',
  './images/reciters/محمد عبدالكربم.jpg',
  './images/reciters/محمود حرفوش.webp',
  './images/reciters/محمود عبدالحكم.jpg',
  './images/reciters/مختار الحاج.jpg',
  './images/reciters/مصطفى رعد العزاوي.jpg',
  './images/reciters/موسى بلال.jpg',
  './images/reciters/ناصر الماجد.webp',
  './images/reciters/نبيل الرفاعي.webp',
  './images/reciters/نذير المالكي.jpeg',
  './images/reciters/نعمة الحسان.jpg',
  './images/reciters/هاشم أبو دلال.webp',
  './images/reciters/هاني الرفاعي.webp',
  './images/reciters/يحيى حوا.webp',
  './images/reciters/يوسف الشويعي.jpg',
  './images/reciters/يوسف العيدروس.jpg',
  './images/reciters/يوسف العيدروس.webp',
  './images/reciters/يوسف بن نوح أحمد.jpg',
];

// 1. تثبيت الـ Service Worker وتخزين الملفات
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// 2. تفعيل الـ Service Worker وتنظيف الكاش القديم عند التحديث
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME && cache !== API_CACHE_NAME && cache !== AUDIO_CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 3. قراءة الملفات من الكاش أولاً لتسريع التطبيق والعمل بدون إنترنت
// مهلة للطلبات اللي الـ SW بيمرّرها للشبكة: من غيرها الطلب على نت ضعيف ممكن
// يفضل معلّق للأبد فتفضل الشاشات واقفة. بعد المهلة بنرجّع 503 والتطبيق يعيد المحاولة
function swFetchWithTimeout(request, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

self.addEventListener('fetch', (event) => {
  const reqURL = new URL(event.request.url);

  // أي طلب لمصدر خارجي مش من مصادر بيانات القرآن المعروفة (API_HOSTS) —
  // زي روابط بث الإذاعات الحية (radiojar.com وغيرها) — لازم نسيبه يعدي
  // للشبكة مباشرة من غير ما الـ Service Worker يتدخل فيه (بدون respondWith).
  // السبب: بعض بوابات البث (زي radiojar) بتعمل إعادة توجيه (302 redirect)
  // للسيرفر الفعلي، ولو الطلب ده اتمرر من جوه الـ SW، المتصفح بيرفض
  // الاستجابة الناتجة (opaque response بعد redirect لمصدر بدون CORS)
  // ويطلع كأنه فشل اتصال فورًا — حتى لو الرابط شغال عادي برة التطبيق.
  // معالجة الأخطاء وإعادة المحاولة الخاصة بكل إذاعة موجودة أصلًا في app.js.
  if (reqURL.origin !== self.location.origin && !API_HOSTS.includes(reqURL.hostname)) {
    return;
  }

  // Keep the updater manifest fresh so a maintainer can disable a broken
  // release without an old service-worker copy continuing to force it.
  if (reqURL.hostname === 'raw.githubusercontent.com' && /\/update\.json$/.test(reqURL.pathname)) {
    return;
  }

  // طلبات بيانات القرآن (صفحات المصحف، التفسير، الصوت، معاني الكلمات): كاش أولاً ثم شبكة،
  // وأي استجابة ناجحة تُخزَّن دائمًا حتى تعمل لاحقًا بدون إنترنت (تُستخدم من زر "تحميل كل الصفحات"
  // في الإعدادات، وأيضًا تلقائيًا مع كل صفحة/آية يقرأها المستخدم بشكل عادي)
  // ملفات بيانات الصرف المحلية (sarf/{رقم السورة}.json): جزء من التطبيق نفسه
  // ومتاحة أوفلاين دايمًا داخل تطبيق الأندرويد (مُجمَّعة في حزمة الـ APK ذاتها)،
  // لكن في نسخة الويب (PWA) لازم تتخزن أول مرة تتفتح فيها زي بيانات القرآن
  // الأخرى، حتى تفضل متاحة أوفلاين لاحقًا بدون إعادة تحميلها من الشبكة كل مرة
  if (/\/sarf\/\d+\.json$/.test(reqURL.pathname)) {
    event.respondWith(
      caches.open(API_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        try {
          const netRes = await swFetchWithTimeout(event.request, 20000);
          if (netRes && netRes.ok) {
            try { await cache.put(event.request, netRes.clone()); } catch (cacheErr) { /* عند امتلاء الذاكرة */ }
          }
          return netRes;
        } catch (e) {
          return cached || new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } });
        }
      })
    );
    return;
  }

  if (API_HOSTS.includes(reqURL.hostname)) {
    event.respondWith(
      caches.open(API_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        try {
          const netRes = await swFetchWithTimeout(event.request, 20000);
          if (netRes && netRes.ok) {
            try {
              // ننتظر التخزين فعليًا (بدل استدعاء بدون await) حتى نلتقط أي فشل
              // تخزين (مثلاً QuotaExceededError عند امتلاء مساحة الجهاز) بدل ما
              // يختفي بصمت ويوهم المستخدم إن الصفحة اتخزنت وهي فعليًا لأ
              await cache.put(event.request, netRes.clone());
            } catch (cacheErr) {
              // فشل التخزين فقط لا يعني فشل الطلب نفسه؛ لسه هنرجّع الاستجابة
              // من الشبكة عشان تتعرض عاديًا للمستخدم وهو أونلاين، لكن التحقق
              // من جهة التطبيق (app.js) هو اللي هيكتشف إنها متتخزنش ويعيد المحاولة
            }
          }
          return netRes;
        } catch (e) {
          return cached || new Response(JSON.stringify({ error: true, offline: true }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request, { ignoreSearch: event.request.mode === 'navigate' }).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});
