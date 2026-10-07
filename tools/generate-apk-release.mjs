import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { isValidManifest } = require('./apk-update-core.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readProperties(filePath) {
  const values = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const text = line.trim();
    if (!text || text.startsWith('#')) continue;
    const index = text.indexOf('=');
    if (index < 1) throw new Error(`Invalid properties line in ${filePath}`);
    values[text.slice(0, index).trim()] = text.slice(index + 1).trim();
  }
  return values;
}

const version = readProperties(path.join(root, 'version.properties'));
const versionName = version.versionName;
const versionCode = Number(version.versionCode);
const repo = process.env.GITHUB_REPOSITORY || '';
const tagName = process.env.GITHUB_REF_NAME || '';
const defaultBranch = process.env.GITHUB_DEFAULT_BRANCH || 'main';
const hash = process.env.APK_SHA256 || '';
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('GITHUB_REPOSITORY is missing or invalid.');
if (!/^[A-Za-z0-9_.-]{1,100}$/.test(defaultBranch)) throw new Error('The repository default branch must not contain slashes.');
if (tagName !== `v${versionName}`) throw new Error(`Tag ${tagName} must match version.properties (${`v${versionName}`}).`);
if (!Number.isSafeInteger(versionCode) || versionCode < 1) throw new Error('version.properties must contain a positive versionCode.');
if (!/^[a-fA-F0-9]{64}$/.test(hash)) throw new Error('APK_SHA256 must be a 64-character SHA-256 value.');

const config = JSON.parse(fs.readFileSync(path.join(root, 'release-config.json'), 'utf8'));
if (!Number.isSafeInteger(config.minimumVersionCode) || config.minimumVersionCode < 1 || config.minimumVersionCode > versionCode) {
  throw new Error('release-config.json minimumVersionCode must be between 1 and this release versionCode.');
}
const releaseNotes = JSON.parse(fs.readFileSync(path.join(root, 'release-notes.json'), 'utf8'));
const validNotes = (items) => Array.isArray(items) && items.length > 0 && items.length <= 3 && items.every((item) => typeof item === 'string' && item.trim() && item.length <= 160);
const supportedLanguages = ['ar', 'fa', 'en', 'fr', 'tr', 'ur', 'id', 'ru', 'es'];
if (Array.isArray(releaseNotes)) {
  if (releaseNotes.length > 3 || !releaseNotes.every((item) => typeof item === 'string' && item.trim() && item.length <= 160)) {
    throw new Error('release-notes.json must contain up to 3 concise, non-empty strings.');
  }
} else if (!releaseNotes || typeof releaseNotes !== 'object' || Object.keys(releaseNotes).length !== supportedLanguages.length || !supportedLanguages.every((language) => validNotes(releaseNotes[language]))) {
  throw new Error(`release-notes.json must contain short notes for all supported languages: ${supportedLanguages.join(', ')}.`);
}

const manifest = {
  enabled: config.enabled !== false,
  versionName,
  versionCode,
  minimumVersionCode: config.minimumVersionCode,
  releaseDate: new Date().toISOString().slice(0, 10),
  tagName,
  downloadUrl: `https://github.com/${repo}/releases/latest/download/AlAshraf.apk`,
  sha256: hash.toLowerCase(),
  releaseNotes
};
if (!isValidManifest(manifest, repo)) throw new Error('Generated update manifest failed schema/security validation.');

const outputDir = path.join(root, '.release-work');
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'update.json'), `${JSON.stringify(manifest, null, 2)}\n`);
const releaseMarkdown = Array.isArray(releaseNotes)
  ? releaseNotes.map((note) => `- ${note}`).join('\n')
  : supportedLanguages.map((language) => `### ${language.toUpperCase()}\n${releaseNotes[language].map((note) => `- ${note}`).join('\n')}`).join('\n\n');
fs.writeFileSync(path.join(outputDir, 'release-notes.md'), `${releaseMarkdown}\n`);
fs.writeFileSync(path.join(root, 'www', 'update-config.json'), `${JSON.stringify({ manifestUrl: `https://raw.githubusercontent.com/${repo}/${defaultBranch}/update.json` }, null, 2)}\n`);
console.log(`Prepared signed release metadata for ${tagName} (versionCode ${versionCode}).`);
