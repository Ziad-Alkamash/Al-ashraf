'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseManifestUrl, isValidManifest, getUpdateDecision } = require('../www/apk-update-core.js');

const repository = 'ashrafjaheen/proj-updated';
const manifestUrl = {
  enabled: true,
  versionName: '5.2.0',
  versionCode: 14,
  minimumVersionCode: 13,
  releaseDate: '2026-10-06',
  tagName: 'v5.2.0',
  downloadUrl: 'https://github.com/ashrafjaheen/proj-updated/releases/latest/download/AlAshraf.apk',
  sha256: 'a'.repeat(64),
  releaseNotes: ['تحسين أداء التطبيق', 'إصلاح بعض الأخطاء']
};

test('accepts only the configured HTTPS raw GitHub manifest endpoint', () => {
  assert.deepEqual(parseManifestUrl('https://raw.githubusercontent.com/ashrafjaheen/proj-updated/main/update.json'), {
    ownerRepo: repository,
    branch: 'main'
  });
  assert.equal(parseManifestUrl('http://raw.githubusercontent.com/ashrafjaheen/proj-updated/main/update.json'), null);
  assert.equal(parseManifestUrl('https://example.com/ashrafjaheen/proj-updated/main/update.json'), null);
});

test('shows an optional update only when remote versionCode is greater', () => {
  assert.deepEqual(getUpdateDecision(13, null, repository), { available: false, forced: false });
  assert.deepEqual(getUpdateDecision(13, manifestUrl, repository), { available: true, forced: false });
  assert.deepEqual(getUpdateDecision(14, manifestUrl, repository), { available: false, forced: false });
  assert.deepEqual(getUpdateDecision(15, manifestUrl, repository), { available: false, forced: false });
});

test('marks updates below minimumVersionCode as forced', () => {
  const forced = { ...manifestUrl, minimumVersionCode: 14 };
  assert.deepEqual(getUpdateDecision(13, forced, repository), { available: true, forced: true });
  assert.deepEqual(getUpdateDecision(14, forced, repository), { available: false, forced: false });
});

test('disabled manifest and malformed or mismatched metadata never produce an update', () => {
  assert.deepEqual(getUpdateDecision(13, { ...manifestUrl, enabled: false }, repository), { available: false, forced: false });
  assert.equal(isValidManifest({ ...manifestUrl, downloadUrl: 'https://evil.example/AlAshraf.apk' }, repository), false);
  assert.equal(isValidManifest({ ...manifestUrl, sha256: 'short' }, repository), false);
  assert.equal(isValidManifest({ ...manifestUrl, minimumVersionCode: 15 }, repository), false);
  assert.equal(isValidManifest({ ...manifestUrl, downloadUrl: 'https://github.com/other/repo/releases/latest/download/AlAshraf.apk' }, repository), false);
});

test('accepts concise release notes localized for all app languages', () => {
  const releaseNotes = Object.fromEntries(['ar', 'fa', 'en', 'fr', 'tr', 'ur', 'id', 'ru', 'es'].map((language) => [language, ['Fix some bugs']]));
  assert.equal(isValidManifest({ ...manifestUrl, releaseNotes }, repository), true);
  assert.equal(isValidManifest({ ...manifestUrl, releaseNotes: { ...releaseNotes, xx: ['Fix some bugs'] } }, repository), false);
  assert.equal(isValidManifest({ ...manifestUrl, releaseNotes: ['إصلاح بعض الأخطاء'], localizedReleaseNotes: releaseNotes }, repository), true);
  assert.equal(isValidManifest({ ...manifestUrl, releaseNotes: ['إصلاح بعض الأخطاء'], localizedReleaseNotes: { ...releaseNotes, xx: ['Fix some bugs'] } }, repository), false);
});
