// المصحف الأشرف — كاشف اتصال حقيقي بدل الاعتماد على navigator.onLine وحده
//
// المشكلة: أكتر من ١٢ موضع في التطبيق (تحميل الصفحات والصوت، التفسير، الختمة
// الجماعية/Firebase، الصوتيات...) بيرفض يبعت أي طلب أصلًا لو
// navigator.onLine === false، من غير ما يجرّب الشبكة فعليًا. وداخل WebView
// أندرويد القيمة دي بتطلع false غلط في حالات كتير (واي فاي متصل بدون تحقق
// إنترنت، VPN أو DNS خاص، شبكة بيانات بعد واي فاي، أو غياب صلاحية
// ACCESS_NETWORK_STATE) — فيبان التطبيق "أوفلاين" والنت شغّال تمامًا برّاه.
//
// الحل: نخلّي navigator.onLine يرجّع true لو الجهاز فعلًا وصل لشبكة (طلب
// اختبار خفيف نجح). لو الاختبار فشل فعلًا يفضل يرجّع القيمة الأصلية (أوفلاين
// حقيقي)، فباقي منطق التطبيق للعمل بدون إنترنت ما بيتأثرش.
(function () {
  'use strict';
  if (typeof navigator === 'undefined') return;
  var proto = Object.getPrototypeOf(navigator);
  var desc = proto && Object.getOwnPropertyDescriptor(proto, 'onLine');
  if (!desc || typeof desc.get !== 'function' || desc.configurable === false) return;
  var nativeGet = desc.get;

  var proofUntil = 0;          // لحد إمتى نعتبر آخر اختبار ناجح صالح
  var probing = false;
  var PROOF_TTL_MS = 60 * 1000;
  var PROBE_URLS = [
    'https://www.gstatic.com/generate_204',
    'https://api.aladhan.com/v1/currentTime?zone=UTC'
  ];

  function nativeOnline() {
    try { return !!nativeGet.call(navigator); } catch (e) { return true; }
  }

  Object.defineProperty(proto, 'onLine', {
    configurable: true,
    enumerable: desc.enumerable,
    get: function () { return nativeOnline() || Date.now() < proofUntil; }
  });

  function probeOnce(url) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 6000);
    return fetch(url, { mode: 'no-cors', cache: 'no-store', signal: controller ? controller.signal : undefined })
      .then(function () { clearTimeout(timer); return true; })
      .catch(function () { clearTimeout(timer); return false; });
  }

  // بنشغّل الاختبار بس لما الحالة الأصلية بتقول "أوفلاين" (لو بتقول أونلاين
  // مفيش داعي لأي طلب إضافي). بيجرّب أكتر من عنوان قبل ما يستسلم
  function probe() {
    if (probing || nativeOnline()) return Promise.resolve(true);
    probing = true;
    var i = 0;
    function next() {
      if (i >= PROBE_URLS.length) return Promise.resolve(false);
      return probeOnce(PROBE_URLS[i++]).then(function (ok) { return ok ? true : next(); });
    }
    return next().then(function (ok) {
      probing = false;
      if (ok) {
        var wasOffline = Date.now() >= proofUntil;
        proofUntil = Date.now() + PROOF_TTL_MS;
        if (wasOffline) { try { window.dispatchEvent(new Event('online')); } catch (e) { /* تجاهل */ } }
      } else {
        proofUntil = 0;
      }
      return ok;
    });
  }

  window.__netProbe = probe;
  // اختبار فوري عند التشغيل وعند أي تغيّر في حالة الشبكة، وبعدين دوري كل ٢٠
  // ثانية طالما الحالة الأصلية بتقول أوفلاين (بيتوقف لوحده لما تبقى أونلاين)
  probe();
  window.addEventListener('offline', function () { probe(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) probe(); });
  setInterval(function () { if (!nativeOnline()) probe(); }, 20000);
})();
