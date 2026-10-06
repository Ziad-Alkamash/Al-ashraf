/* Warsh mushaf pages and text, loaded on demand and cached for offline use. */
(function (global) {
  'use strict';
  const SVG_BASE = 'https://cdn.quran.ws/svg/pages/v1.1.1/warsh-kfqc/';
  const API_BASE = 'https://api.quranpedia.net/v1/mushafs/4/';

  function pad3(n) { return String(n).padStart(3, '0'); }
  function pagePath(page) { return `Quran/warsh/svg/${pad3(page)}.svg`; }

  async function getPageSVG(page) {
    if (!Number.isInteger(Number(page)) || page < 1 || page > 604) throw new Error('رقم صفحة ورش غير صحيح');
    const url = `${SVG_BASE}${pad3(page)}.svg`;
    if (global.QuranOffline && global.QuranOffline.cacheFetchText) {
      return global.QuranOffline.cacheFetchText(url, pagePath(page));
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error(`تعذر تحميل صفحة ورش (${response.status})`);
    return response.text();
  }

  async function getAyah(surah, ayah) {
    const url = `${API_BASE}${Number(surah)}/${Number(ayah)}`;
    const relPath = `Quran/warsh/ayahs/${Number(surah)}-${Number(ayah)}.json`;
    let data;
    if (global.QuranOffline && global.QuranOffline.cacheFetchJSON) {
      data = await global.QuranOffline.cacheFetchJSON(url, relPath);
    } else {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`تعذر تحميل آية ورش (${response.status})`);
      data = await response.json();
    }
    return Array.isArray(data) ? data[0] : data;
  }

  function mountPage(container, svgText, onLongPress, pageNumber) {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.localName !== 'svg' || doc.querySelector('parsererror')) throw new Error('ملف صفحة ورش غير صالح');
    const imported = document.importNode(root, true);
    imported.setAttribute('class', `${imported.getAttribute('class') || ''} warsh-svg-page`.trim());
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
      path.classList.add('qcf-ayah', 'warsh-ayah');
      path.dataset.surah = String(surah);
      path.dataset.ayah = String(ayah);
      path.style.cursor = 'pointer';
      onLongPress(path, surah, ayah);
    });
    container.replaceChildren(imported);
    return imported;
  }

  global.QuranWarsh = { getPageSVG, getAyah, mountPage };
})(window);
