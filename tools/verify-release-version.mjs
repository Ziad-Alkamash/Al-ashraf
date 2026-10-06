import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = process.env.GITHUB_REPOSITORY || '';
const token = process.env.GITHUB_TOKEN || '';
const tag = process.env.GITHUB_REF_NAME || '';
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !token) throw new Error('GitHub repository and token are required to validate release history.');
const props = Object.fromEntries(fs.readFileSync(path.join(root, 'version.properties'), 'utf8').split(/\r?\n/).filter((line) => line && !line.startsWith('#')).map((line) => {
  const index = line.indexOf('=');
  return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
}));
const config = JSON.parse(fs.readFileSync(path.join(root, 'release-config.json'), 'utf8'));
const currentCode = Number(props.versionCode);
if (!Number.isSafeInteger(currentCode) || currentCode < 1 || tag !== `v${props.versionName}`) throw new Error('Tag must be v<versionName> and versionCode must be a positive integer.');

const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
const releases = [];
for (let page = 1; page <= 10; page += 1) {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`, { headers });
  if (!response.ok) throw new Error(`Could not read GitHub releases (HTTP ${response.status}).`);
  const batch = await response.json();
  releases.push(...batch);
  if (batch.length < 100) break;
}

let highestCode = Number.isSafeInteger(config.minimumPreviousVersionCode) ? config.minimumPreviousVersionCode : 0;
for (const release of releases) {
  if (release.draft || release.prerelease || release.tag_name === tag) continue;
  const manifestAsset = release.assets?.find((asset) => asset.name === 'update.json');
  if (!manifestAsset) continue;
  const response = await fetch(manifestAsset.url, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/octet-stream', 'X-GitHub-Api-Version': '2022-11-28' }
  });
  if (!response.ok) throw new Error(`Could not verify version history for ${release.tag_name}.`);
  let previous;
  try { previous = JSON.parse(await response.text()); } catch { throw new Error(`Release ${release.tag_name} has an invalid update.json asset.`); }
  if (Number.isSafeInteger(previous.versionCode)) highestCode = Math.max(highestCode, previous.versionCode);
}
if (currentCode <= highestCode) throw new Error(`versionCode ${currentCode} must be greater than the previous release code ${highestCode}.`);
console.log(`versionCode ${currentCode} is greater than the published release history (${highestCode}).`);
