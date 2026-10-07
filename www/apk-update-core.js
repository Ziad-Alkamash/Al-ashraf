(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AlAshrafUpdateCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION_NAME = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/;
  const TAG_NAME = /^v[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;
  const HASH = /^[a-fA-F0-9]{64}$/;
  const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

  function parseManifestUrl(raw) {
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || url.hostname !== 'raw.githubusercontent.com' || url.port || url.search || url.hash || url.username || url.password) return null;
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length !== 4 || !NAME.test(parts[0]) || !NAME.test(parts[1]) || !NAME.test(parts[2]) || parts[3] !== 'update.json') return null;
      return { ownerRepo: `${parts[0]}/${parts[1]}`, branch: parts[2] };
    } catch (_) { return null; }
  }

  function isValidManifest(manifest, ownerRepo) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return false;
    const parts = typeof ownerRepo === 'string' ? ownerRepo.split('/') : [];
    if (parts.length !== 2 || !NAME.test(parts[0]) || !NAME.test(parts[1])) return false;
    if (typeof manifest.enabled !== 'boolean') return false;
    if (typeof manifest.versionName !== 'string' || !VERSION_NAME.test(manifest.versionName)) return false;
    if (!Number.isSafeInteger(manifest.versionCode) || manifest.versionCode < 1) return false;
    if (!Number.isSafeInteger(manifest.minimumVersionCode) || manifest.minimumVersionCode < 1 || manifest.minimumVersionCode > manifest.versionCode) return false;
    if (typeof manifest.releaseDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(manifest.releaseDate)) return false;
    const releaseDate = new Date(`${manifest.releaseDate}T00:00:00Z`);
    if (Number.isNaN(releaseDate.getTime()) || releaseDate.toISOString().slice(0, 10) !== manifest.releaseDate) return false;
    if (typeof manifest.sha256 !== 'string' || !HASH.test(manifest.sha256)) return false;
    const validNotes = (notes) => Array.isArray(notes) && notes.length > 0 && notes.length <= 3 && notes.every((note) => typeof note === 'string' && note.trim().length > 0 && note.length <= 160);
    const supportedLanguages = ['ar', 'fa', 'en', 'fr', 'tr', 'ur', 'id', 'ru', 'es'];
    const validLocalizedNotes = (notes) => notes && typeof notes === 'object' && !Array.isArray(notes)
      && Object.keys(notes).length === supportedLanguages.length
      && supportedLanguages.every((language) => Object.hasOwn(notes, language) && validNotes(notes[language]));
    if (Array.isArray(manifest.releaseNotes)) {
      if (manifest.releaseNotes.length > 3 || !manifest.releaseNotes.every((note) => typeof note === 'string' && note.trim().length > 0 && note.length <= 160)) return false;
    } else {
      if (!validLocalizedNotes(manifest.releaseNotes)) return false;
    }
    if (manifest.localizedReleaseNotes !== undefined && !validLocalizedNotes(manifest.localizedReleaseNotes)) return false;
    if (typeof manifest.tagName !== 'string' || !TAG_NAME.test(manifest.tagName) || manifest.tagName !== `v${manifest.versionName}`) return false;
    if (typeof manifest.downloadUrl !== 'string') return false;
    try {
      const url = new URL(manifest.downloadUrl);
      const stablePath = `/${parts[0]}/${parts[1]}/releases/latest/download/AlAshraf.apk`;
      const pinnedPath = `/${parts[0]}/${parts[1]}/releases/download/${manifest.tagName}/AlAshraf.apk`;
      return url.protocol === 'https:' && url.hostname === 'github.com' && !url.port && !url.username && !url.password && !url.search && !url.hash && [stablePath, pinnedPath].includes(url.pathname);
    } catch (_) { return false; }
  }

  function getUpdateDecision(installedVersionCode, manifest, ownerRepo) {
    if (!Number.isSafeInteger(installedVersionCode) || installedVersionCode < 1 || !isValidManifest(manifest, ownerRepo) || !manifest.enabled) return { available: false, forced: false };
    const available = manifest.versionCode > installedVersionCode;
    return { available, forced: available && installedVersionCode < manifest.minimumVersionCode };
  }

  return { parseManifestUrl, isValidManifest, getUpdateDecision };
});
