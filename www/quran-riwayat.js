/* Qalun SVG pages and Al-Susi text pages, loaded only when selected. */
(function (global) {
  'use strict';

  const SVG_BASE = 'https://cdn.quran.ws/svg/pages/v1.1.1/qalon-kfqc/';
  const API_BASE = 'https://api.quranpedia.net/v1/mushafs/';
  const susiDataUrl = `${API_BASE}10`;
  let susiDataPromise = null;
  let susiFontPromise = null;

  function pad3(n) { return String(n).padStart(3, '0'); }

  async function fetchJSON(url, path) {
    if (global.QuranOffline && global.QuranOffline.cacheFetchJSON) {
      return global.QuranOffline.cacheFetchJSON(url, path);
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error(`تعذّر تحميل بيانات الرواية (${response.status})`);
    return response.json();
  }

  async function getQalunPage(page) {
    if (!Number.isInteger(Number(page)) || page < 1 || page > 604) throw new Error('رقم صفحة قالون غير صحيح');
    const url = `${SVG_BASE}${pad3(page)}.svg`;
    if (global.QuranOffline && global.QuranOffline.cacheFetchText) {
      return global.QuranOffline.cacheFetchText(url, `Quran/qalun/svg/${pad3(page)}.svg`);
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error(`تعذّر تحميل صفحة قالون (${response.status})`);
    return response.text();
  }

  function mountSVG(container, svgText, onLongPress, pageNumber) {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.localName !== 'svg' || doc.querySelector('parsererror')) throw new Error('ملف صفحة قالون غير صالح');
    const imported = document.importNode(root, true);
    imported.setAttribute('class', `${imported.getAttribute('class') || ''} riwaya-svg-page qalun-svg-page`.trim());
    imported.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const ratio = (imported.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    const aspectRatio = ratio.length === 4 && ratio.every(Number.isFinite) && ratio[2] > 0 && ratio[3] > 0 ? `${ratio[2]} / ${ratio[3]}` : '345 / 550';
    const autoScrollPage = !!container.closest('.autoscroll-page');
    imported.style.cssText = `display:block;flex:none;align-self:stretch;min-width:0;min-height:0;width:100%;height:${autoScrollPage ? 'auto' : '100%'};aspect-ratio:${autoScrollPage ? aspectRatio : 'auto'};max-width:100%;max-height:${autoScrollPage ? 'none' : '100%'};margin:0;`;
    imported.querySelectorAll('#content, #ayah_markers').forEach((group) => { group.style.pointerEvents = 'none'; });
    imported.querySelectorAll('.ayahPolygon').forEach((path) => {
      const surah = Number(path.getAttribute('surah'));
      const ayah = Number(path.getAttribute('ayah'));
      if (!surah || !ayah) return;
      path.classList.add('qcf-ayah', 'riwaya-ayah');
      path.dataset.surah = String(surah);
      path.dataset.ayah = String(ayah);
      path.style.cursor = 'pointer';
      onLongPress(path, surah, ayah);
    });
    container.replaceChildren(imported);
    return imported;
  }

  async function getSusiData() {
    if (!susiDataPromise) {
      susiDataPromise = fetchJSON(susiDataUrl, 'Quran/susi/mushaf.json').then((data) => {
        const surahs = Array.isArray(data) ? data : data && data.surahs;
        if (!Array.isArray(surahs) || !surahs.length) throw new Error('بيانات مصحف السوسي غير صالحة');
        return { metadata: Array.isArray(data) ? null : data, surahs };
      }).catch((error) => { susiDataPromise = null; throw error; });
    }
    return susiDataPromise;
  }

  async function ensureSusiFont() {
    if (!susiFontPromise) {
      susiFontPromise = (async () => {
        const { metadata } = await getSusiData();
        const fontUrl = metadata && metadata.font_file;
        if (!fontUrl || !global.FontFace) return;
        let source = fontUrl;
        if (global.QuranOffline && global.QuranOffline.ensureFontCached) {
          source = await global.QuranOffline.ensureFontCached(fontUrl, 'Quran/susi/fonts/susi.woff2');
        }
        const face = new FontFace('QuranSusi', `url("${source}")`);
        await face.load();
        document.fonts.add(face);
      })().catch((error) => { susiFontPromise = null; throw error; });
    }
    return susiFontPromise;
  }

  async function getSusiPage(page) {
    if (!Number.isInteger(Number(page)) || page < 1 || page > 604) throw new Error('رقم صفحة السوسي غير صحيح');
    const { surahs } = await getSusiData();
    const ayahs = [];
    surahs.forEach((surah) => (surah.ayahs || []).forEach((ayah) => {
      if (Number(ayah.page_number) === Number(page)) ayahs.push({
        surah: Number(ayah.surah || surah.id),
        number: Number(ayah.number),
        text: String(ayah.text || ''),
        marker: ayah.marker || ''
      });
    }));
    if (!ayahs.length) throw new Error('لا توجد بيانات لهذه الصفحة في مصحف السوسي');
    try { await ensureSusiFont(); } catch (error) { console.warn('خط السوسي غير متاح، سيتم استخدام خط المصحف البديل:', error); }
    return ayahs;
  }

  async function getSusiPageForAyah(surah, ayah) {
    const { surahs } = await getSusiData();
    for (const item of surahs) {
      const found = (item.ayahs || []).find((entry) =>
        Number(entry.surah || item.id) === Number(surah) && Number(entry.number) === Number(ayah));
      if (found && Number(found.page_number)) return Number(found.page_number);
    }
    return null;
  }

  async function getSusiAyah(surah, ayah) {
    const data = await fetchJSON(`${API_BASE}10/${Number(surah)}/${Number(ayah)}`, `Quran/susi/ayahs/${Number(surah)}-${Number(ayah)}.json`);
    return Array.isArray(data) ? data[0] : data;
  }

  async function getQalunAyah(surah, ayah) {
    const data = await fetchJSON(`${API_BASE}7/${Number(surah)}/${Number(ayah)}`, `Quran/qalun/ayahs/${Number(surah)}-${Number(ayah)}.json`);
    return Array.isArray(data) ? data[0] : data;
  }

  global.QuranRiwayat = { getQalunPage, getQalunAyah, mountSVG, getSusiPage, getSusiPageForAyah, getSusiAyah, getSusiData, ensureSusiFont };
})(window);
