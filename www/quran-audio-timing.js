/* فهرس قراء MP3Quran وتوقيت الآيات. تُجلب خيارات القراء والروايات من الموقع،
   ويُستخدم ملف القراءة المسجل نفسه عندما يوفّر الموقع توقيتًا مطابقًا. */
(function (global) {
  'use strict';

  const READS_URL = 'https://www.mp3quran.net/api/v3/ayat_timing/reads';
  const RECITERS_URL = 'https://www.mp3quran.net/api/v3/reciters?language=ar';
  const RECITERS_EN_URL = 'https://www.mp3quran.net/api/v3/reciters?language=eng';
  const TIMING_URL = 'https://www.mp3quran.net/api/v3/ayat_timing';
  const READS_CACHE_KEY = 'almus-hraf:mp3quran-timing-reads:v7';
  // v9 forces every reader/surah pair to be fetched again from MP3Quran.
  // Previous timing maps may have been saved against a mismatched audio file.
  const TIMING_CACHE_PREFIX = 'almus-hraf:mp3quran-ayah-timing:v9:';
  const READS_TTL = 7 * 24 * 60 * 60 * 1000;
  const CATALOG_CACHE_KEY = 'almus-hraf:mp3quran-reciter-catalog:v7';
  const CATALOG_TTL = 24 * 60 * 60 * 1000;
  const TIMING_TTL = 30 * 24 * 60 * 60 * 1000;
  const pending = new Map();
  let readsRequest = null;
  let catalogRequest = null;
  let catalogReciters = null;

  // Erase previously generated timing/catalog data on this device. The
  // current cache namespace is intentionally retained between launches;
  // anything from earlier builds is fetched again from MP3Quran.
  function purgePreviousTimingCaches() {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key.startsWith('almus-hraf:mp3quran-ayah-timing:') && !key.startsWith(TIMING_CACHE_PREFIX)) {
          localStorage.removeItem(key);
        } else if (key.startsWith('almus-hraf:mp3quran-timing-reads:') && key !== READS_CACHE_KEY) {
          localStorage.removeItem(key);
        } else if (key.startsWith('almus-hraf:mp3quran-reciter-catalog:') && key !== CATALOG_CACHE_KEY) {
          localStorage.removeItem(key);
        }
      }
    } catch (_) { /* localStorage may be unavailable in private browsing */ }
  }
  purgePreviousTimingCaches();
  // اسم/معرّف المصدر الرسمي صريح للقارئ الذي قد تختلف تسميته في الفهارس.
  const READ_ID_BY_EDITION = Object.freeze({
    'ar.haithamaldukhain': 273,
    'ar.shaatree': 4,
    'ar.ahmedajamy': 5,
    'ar.hudhaify': 74,
    'ar.mustafaismail': 288,
    'ar.alijaber': 76,
    'ar.abdulbasitmjwd': 51,
    'ar.husarymjwd': 119,
    'ar.bannamjwd': 122,
    'warsh.husary': 120,
    'warsh.koshi': 16,
    'warsh.omaralqazabri': 80,
    'warsh.yassin-al-jazairi': 14,
    'qalun.husary': 270,
    'qalun.hudhaify': 75,
    'qalun.dokali': 208,
    'susi.soufi': 65,
    'way2quran.hassan-saleh.hafs': 299,
    'way2quran.bandar-balila.hafs': 217
  });
  function readCache(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value && Array.isArray(value.items) && Number.isFinite(value.savedAt) ? value : null;
    } catch (_) { return null; }
  }

  function storeCache(key, items, extra) {
    try { localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), items, ...(extra || {}) })); } catch (_) { /* مساحة التخزين ممتلئة */ }
  }

  async function fetchJson(url) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 9000) : null;
    try {
      const response = await fetch(url, controller ? { signal: controller.signal } : undefined);
      if (!response.ok) throw new Error(`MP3Quran timing API ${response.status}`);
      return await response.json();
    } finally { if (timeout) clearTimeout(timeout); }
  }

  async function loadReads() {
    const cached = readCache(READS_CACHE_KEY);
    if (cached && Date.now() - cached.savedAt < READS_TTL) return cached.items;
    if (readsRequest) return readsRequest;
    readsRequest = fetchJson(READS_URL).then((items) => {
      if (!Array.isArray(items)) throw new Error('صيغة قائمة التوقيت غير صحيحة');
      storeCache(READS_CACHE_KEY, items);
      return items;
    }).catch((error) => {
      if (cached) return cached.items;
      throw error;
    }).finally(() => { readsRequest = null; });
    return readsRequest;
  }

  function editionFromMoshaf(moshaf) {
    const text = String(moshaf && moshaf.name || '');
    if (/ورش/.test(text)) return 'warsh';
    if (/قالون/.test(text)) return 'qalun';
    if (/السوسي|الدوري عن أبي عمرو/.test(text)) return 'susi';
    return 'hafs';
  }

  function matchCatalogTiming(moshaf, reads) {
    const family = editionFromMoshaf(moshaf);
    const belongsToFamily = (read) => {
      const rewaya = normalizedName(read.rewaya);
      if (family === 'warsh') return /ورش/.test(rewaya);
      if (family === 'qalun') return /قالون/.test(rewaya);
      if (family === 'susi') return /السوسي|الدوري/.test(rewaya);
      return /حفص|شعبة|المصحف المجود/.test(rewaya);
    };
    const source = normalizedUrl(moshaf.server);
    const exactSourceRead = reads.find((read) => source &&
      source === normalizedUrl(read.folder_url) && belongsToFamily(read));
    // نستخدم سجل التوقيت فقط عندما يتطابق خادم الصوت حرفيًا مع مجلد القراءة؛
    // تشابه الأسماء وحده قد يربط التوقيت بتسجيل قارئ آخر.
    return exactSourceRead || null;
  }

  function registerSiteCatalog(apiReciters, reads, englishReciters) {
    if (!global.QuranAPI || typeof QuranAPI.registerCustomSurahReciter !== 'function') return [];
    const registered = [];
    const englishById = new Map((englishReciters || []).map((person) => [String(person.id), person]));
    (apiReciters || []).forEach((person) => {
      (person.moshaf || []).forEach((moshaf) => {
        if (!moshaf.server || !/^https?:\/\//i.test(moshaf.server)) return;
        const family = editionFromMoshaf(moshaf);
        const reciterId = `mp3quran.${person.id}.${moshaf.id}`;
        const englishPerson = englishById.get(String(person.id));
        const englishMoshaf = (englishPerson && englishPerson.moshaf || []).find((item) => Number(item.id) === Number(moshaf.id));
        const mode = /مجود|mujawwad/i.test(String(moshaf.name || '')) ? 'مجود' : 'مرتل';
        const timedRead = matchCatalogTiming(moshaf, reads || []);
        const reciter = {
          id: reciterId,
          name: `${String(person.name || '').trim()} — ${String(moshaf.name || '').trim()}`,
          nameLatin: `${String(englishPerson && englishPerson.name || person.name || '').trim()} — ${String(englishMoshaf && englishMoshaf.name || moshaf.name || '').trim()}`,
          nameRu: String(person.name || '').trim(),
          server: moshaf.server,
          mushafEdition: family,
          surahList: moshaf.surah_list || '',
          moshafId: moshaf.id,
          readKind: mode,
          timingReadId: timedRead ? timedRead.id : null,
          catalogSource: 'mp3quran'
        };
        if (QuranAPI.registerCustomSurahReciter(reciter)) {
          const stored = (QuranAPI.RECITERS || []).find((item) => item.id === reciterId);
          if (stored) registered.push(stored);
        }
      });
    });
    return registered;
  }

  async function loadCatalog() {
    if (catalogReciters) return catalogReciters;
    if (catalogRequest) return catalogRequest;
    const cached = readCache(CATALOG_CACHE_KEY);
    catalogRequest = Promise.all([
      fetchJson(RECITERS_URL).then((data) => data && Array.isArray(data.reciters) ? data.reciters : []),
      fetchJson(RECITERS_EN_URL).then((data) => data && Array.isArray(data.reciters) ? data.reciters : []).catch(() => []),
      loadReads().catch(() => [])
    ]).then(([people, englishPeople, reads]) => {
      if (!people.length && cached) {
        catalogReciters = registerSiteCatalog(cached.items, reads, cached.english);
        global.dispatchEvent(new CustomEvent('mp3quran-catalog-updated', { detail: { count: catalogReciters.length } }));
        return catalogReciters;
      }
      if (!people.length) throw new Error('لم يرجع فهرس MP3Quran أي قراء');
      storeCache(CATALOG_CACHE_KEY, people, { english: englishPeople });
      const catalog = registerSiteCatalog(people, reads, englishPeople);
      catalogReciters = catalog;
      global.dispatchEvent(new CustomEvent('mp3quran-catalog-updated', { detail: { count: catalog.length } }));
      return catalog;
    }).catch((error) => {
      if (cached) {
        catalogReciters = registerSiteCatalog(cached.items, [], cached.english);
        global.dispatchEvent(new CustomEvent('mp3quran-catalog-updated', { detail: { count: catalogReciters.length } }));
        return catalogReciters;
      }
      console.warn('تعذّر تحميل فهرس القراء من MP3Quran', error);
      return null;
    }).finally(() => { catalogRequest = null; });
    return catalogRequest;
  }

  function normalizedUrl(value) {
    try {
      const url = new URL(String(value || '').replace(/^http:/i, 'https:'));
      return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, '')}/`;
    } catch (_) { return ''; }
  }

  function normalizedName(value) {
    return String(value || '').normalize('NFKC')
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ة/g, 'ه').replace(/ى/g, 'ي')
      .replace(/[()（）]/g, ' ')
      .replace(/(?:الشيخ|شيخ|القارئ)/g, ' ')
      .replace(/\b(?:murattal|mujawwad)\b/gi, ' ')
      .replace(/مرتل|مجود/g, ' ')
      .replace(/\s*[—–-]\s*(?:ورش|قالون|السوسي)\s*$/u, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function readMatchesNarration(read, reciter) {
    const narration = String(read && read.rewaya || '');
    const id = String(reciter && reciter.id || '');
    const family = String(reciter && reciter.mushafEdition || (/^warsh\./.test(id) ? 'warsh' : /^qalun\./.test(id) ? 'qalun' : /^susi\./.test(id) ? 'susi' : 'hafs'));
    const kind = String(reciter && reciter.readKind || (/mjwd|mujawwad|مجود/i.test(`${id} ${reciter?.name || ''}`) ? 'مجود' : 'مرتل'));
    if (family === 'warsh' && !/ورش/i.test(narration)) return false;
    if (family === 'qalun' && !/قالون/i.test(narration)) return false;
    if (family === 'susi' && !/السوسي|أبي عمرو/i.test(narration)) return false;
    if (family === 'hafs' && kind !== 'مجود' && !/حفص/i.test(narration)) return false;
    if (kind === 'مجود' && !/مجود|المصحف المجود/i.test(narration)) return false;
    return true;
  }

  function matchingRead(ed, reads) {
    if (!global.QuranAPI) return null;
    const selectedReciter = (QuranAPI.RECITERS || []).find((item) => item.id === ed);
    if (selectedReciter && selectedReciter.timingReadId) {
      const exact = reads.find((read) => Number(read.id) === Number(selectedReciter.timingReadId)) || null;
      if (exact && readMatchesNarration(exact, selectedReciter)) return exact;
    }
    const explicitId = READ_ID_BY_EDITION[String(ed || '')];
    if (explicitId) {
      const explicit = reads.find((read) => Number(read.id) === explicitId) || null;
      const reciter = (QuranAPI.RECITERS || []).find((item) => item.id === ed);
      if (explicit && reciter && readMatchesNarration(explicit, reciter)) return explicit;
      // If MP3Quran changes an ID or its narration metadata, continue with
      // the identity-based matcher below instead of disabling timing outright.
    }
    // Dynamic MP3Quran entries must be matched by the API's exact audio folder
    // in registerSiteCatalog. A name-only fallback can pair a new recording
    // with timings from an older recording by the same reader.
    if (selectedReciter && selectedReciter.catalogSource === 'mp3quran') return null;
    const reciter = (QuranAPI.RECITERS || []).find((item) => item.id === ed);
    if (!reciter) return null;
    const name = normalizedName(reciter.name);
    if (!name) return null;
    const nameTokens = new Set(name.split(' ').filter(Boolean));
    const candidates = reads.filter((read) => {
      if (!readMatchesNarration(read, reciter)) return false;
      const readName = normalizedName(read.name);
      if (readName === name || readName.replace(/\s/g, '') === name.replace(/\s/g, '')) return true;
      const readTokens = new Set(readName.split(' ').filter(Boolean));
      const shared = [...nameTokens].filter((token) => readTokens.has(token)).length;
      return shared / Math.min(nameTokens.size, readTokens.size) >= 0.8;
    });
    if (!candidates.length) return null;
    const sourceFolder = normalizedUrl(reciter.server || QuranAPI.getSurahAudioURL(1, ed).replace(/001\.mp3(?:\?.*)?$/i, ''));
    const score = (read) => {
      const readTokens = new Set(normalizedName(read.name).split(' ').filter(Boolean));
      const shared = [...nameTokens].filter((token) => readTokens.has(token)).length;
      const nameScore = shared / Math.max(nameTokens.size, readTokens.size);
      return (normalizedUrl(read.folder_url) === sourceFolder ? 100 : 0) +
        (Number(read.id) === Number(reciter.moshafId) ? 20 : 0) + nameScore;
    };
    const ranked = candidates.map((read) => ({ read, score: score(read) })).sort((a, b) => b.score - a.score);
    if (ranked.length > 1 && ranked[0].score === ranked[1].score) return null;
    return ranked[0].read;
  }

  function normalizeTimings(items) {
    if (!Array.isArray(items)) return null;
    const bounds = items.map((item) => ({
      ayah: Number(item && item.ayah),
      start: Number(item && item.start_time) / 1000,
      end: Number(item && item.end_time) / 1000
    })).filter((item) => Number.isInteger(item.ayah) && item.ayah > 0 &&
      Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
      .sort((a, b) => a.ayah - b.ayah);
    if (!bounds.length || bounds[0].ayah !== 1) return null;
    for (let i = 1; i < bounds.length; i++) {
      if (bounds[i].ayah !== bounds[i - 1].ayah + 1 || bounds[i].start < bounds[i - 1].start) return null;
    }
    return bounds;
  }

  function audioUrlForRead(read, surahNumber) {
    const base = String(read && read.folder_url || '').replace(/^http:/i, 'https://').replace(/\/+$/, '');
    if (!/^https:\/\//i.test(base)) return null;
    return `${base}/${String(surahNumber).padStart(3, '0')}.mp3`;
  }

  function cachedTimingsMatchRead(cached, read, surahNumber) {
    if (!cached || !read || Number(cached.readId) !== Number(read.id)) return false;
    const expected = audioUrlForRead(read, surahNumber);
    return !!expected && normalizedUrl(cached.audioUrl) === normalizedUrl(expected);
  }

  async function getAyahTimings(ed, surah) {
    const surahNumber = Number(surah);
    if (!Number.isInteger(surahNumber) || surahNumber < 1 || surahNumber > 114) return null;
    const key = `${TIMING_CACHE_PREFIX}${encodeURIComponent(ed)}:${surahNumber}`;
    const cached = readCache(key);
    if (pending.has(key)) return pending.get(key);

    const request = (async () => {
      try {
        const reads = await loadReads();
        const read = matchingRead(ed, reads);
        const cacheMatchesRead = cachedTimingsMatchRead(cached, read, surahNumber);
        if (cacheMatchesRead && Date.now() - cached.savedAt < TIMING_TTL) {
          const bounds = normalizeTimings(cached.items);
          if (bounds) return { bounds, audioUrl: cached.audioUrl, readId: Number(read.id) };
        }
        if (!read) return null;
        const items = await fetchJson(`${TIMING_URL}?surah=${surahNumber}&read=${encodeURIComponent(read.id)}`);
        const bounds = normalizeTimings(items);
        if (!bounds) throw new Error('صيغة توقيت الآيات غير صحيحة');
        const audioUrl = audioUrlForRead(read, surahNumber);
        if (!audioUrl) throw new Error('رابط ملف القراءة غير صالح');
        // لا نخزن مضلعات الصفحات وروابطها هنا؛ نحتاج حدود الوقت فقط، وتخزين
        // الحقول الصغيرة يمنع تضخم localStorage بعد الاستماع لسور كثيرة.
        const compactItems = items.map((item) => ({
          ayah: item && item.ayah,
          start_time: item && item.start_time,
          end_time: item && item.end_time
        }));
        storeCache(key, compactItems, { audioUrl, readId: Number(read.id) });
        return { bounds, audioUrl, readId: Number(read.id) };
      } catch (error) {
        if (cachedTimingsMatchRead(cached, read, surahNumber)) {
          const bounds = normalizeTimings(cached.items);
          if (bounds) return { bounds, audioUrl: cached.audioUrl, readId: Number(read.id) };
        }
        console.warn('تعذّر تحميل توقيت الآيات من MP3Quran', error);
        return null;
      }
    })().finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  }

  global.Mp3QuranTiming = { getAyahTimings, loadCatalog, getCatalogReciters: () => catalogReciters };
  loadCatalog();
})(window);
