/* API موثقة تدعم CORS، مع رجوع احتياطي إلى JSONP الرسمي للدرر. */
const SunnahHadithAPI = (() => {
  const BASE = 'https://api.islamic.app/v1/hadith';
  const COLLECTIONS = {
    bukhari: 'صحيح البخاري', muslim: 'صحيح مسلم', nasai: 'سنن النسائي',
    abudawud: 'سنن أبي داود', tirmidhi: 'جامع الترمذي', ibnmajah: 'سنن ابن ماجه',
    malik: 'موطأ مالك', ahmad: 'مسند أحمد', darimi: 'سنن الدارمي',
    riyadussalihin: 'رياض الصالحين', adab: 'الأدب المفرد', shamail: 'الشمائل المحمدية',
    mishkat: 'مشكاة المصابيح', bulugh: 'بلوغ المرام', forty: 'الأربعون النووية',
    hisn: 'حصن المسلم', virtues: 'فضائل القرآن'
  };

  function arabicGrade(grades) {
    if (!Array.isArray(grades) || !grades.length) return '';
    return grades.map((g) => {
      let grade = String(g.grade || '').trim();
      grade = grade.replace(/\bSahih\b/gi, 'صحيح').replace(/\bHasan\b/gi, 'حسن').replace(/\bDa['’]?if\b/gi, 'ضعيف').replace(/\bMawdu['’]?\b/gi, 'موضوع');
      return [grade, g.graded_by].filter(Boolean).join(' — ');
    }).filter(Boolean).join('؛ ');
  }

  function normalizeHadith(hit) {
    const ar = hit.ar || {};
    const chapter = hit.chapterTitle && (hit.chapterTitle.ar || hit.chapterTitle.en);
    return {
      hadith: ar.text || ar.body || hit.text || '',
      rawi: hit.rawi || '',
      mohdith: '',
      book: COLLECTIONS[hit.collection] || hit.collection || '',
      source: COLLECTIONS[hit.collection] || hit.collection || '',
      numberOrPage: [hit.bookNumber, hit.hadithNumber].filter(Boolean).join(' / '),
      grade: arabicGrade(ar.grades || hit.grades),
      chapter: chapter || '',
      sourceUrl: (ar.urn || hit.urn) ? `https://sunnah.com/urn/${encodeURIComponent(ar.urn || hit.urn)}` : ''
    };
  }

  async function fetchJSON(url, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs || 16000);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally { clearTimeout(timeout); }
  }

  function searchOfficialDorar(query) {
    return new Promise((resolve, reject) => {
      const cb = `__dorarFallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement('script');
      let done = false;
      const timeout = setTimeout(() => finish(reject, new Error('timeout')), 12000);
      function finish(fn, value) {
        if (done) return;
        done = true; clearTimeout(timeout); script.onerror = null; script.remove();
        try { delete window[cb]; } catch (_) { window[cb] = undefined; }
        fn(value);
      }
      window[cb] = (payload) => {
        if (!payload || !Array.isArray(payload.ahadith)) return finish(reject, new Error('bad response'));
        const plain = (v) => { const node = document.createElement('div'); node.innerHTML = String(v || ''); return (node.textContent || '').replace(/\s+/g, ' ').trim(); };
        finish(resolve, payload.ahadith.map((x) => ({ hadith: plain(x.th || x.hadith), grade: plain(x.grade || x.hukm), rawi: plain(x.rawi), mohdith: plain(x.mohdith), book: plain(x.book), source: plain(x.source), numberOrPage: plain(x.numberOrPage) })));
      };
      script.async = true;
      script.src = `https://dorar.net/dorar_api.json?skey=${encodeURIComponent(query)}&callback=${encodeURIComponent(cb)}`;
      script.onerror = () => finish(reject, new Error('Dorar unavailable'));
      document.head.appendChild(script);
    });
  }

  async function search(query) {
    const value = String(query || '').trim();
    if (value.length < 2) throw new Error('اكتب كلمتين على الأقل.');
    const params = new URLSearchParams({ q: value, lang: 'ar', limit: '50' });
    try {
      const payload = await fetchJSON(`${BASE}/search?${params}`);
      if (!payload || payload.code !== 200 || !payload.data || !Array.isArray(payload.data.results)) throw new Error('استجابة غير مكتملة');
      return payload.data.results.map(normalizeHadith);
    } catch (primaryError) {
      try { return await searchOfficialDorar(value); }
      catch (_) { throw new Error('تعذر الوصول إلى مصادر البحث الآن. تحقق من اتصال الإنترنت ثم أعد المحاولة.'); }
    }
  }

  async function today() {
    const payload = await fetchJSON(`${BASE}/today`, 12000);
    if (!payload || payload.code !== 200 || !payload.data || !payload.data.ar) throw new Error('daily hadith unavailable');
    return normalizeHadith(payload.data);
  }

  return { search, today };
})();
