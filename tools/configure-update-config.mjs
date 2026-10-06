import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = process.env.GITHUB_REPOSITORY || '';
const branch = process.env.GITHUB_DEFAULT_BRANCH || 'main';
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('Set GITHUB_REPOSITORY to owner/repository.');
if (!/^[A-Za-z0-9_.-]{1,100}$/.test(branch)) throw new Error('The default branch name must not contain slashes.');
const config = { manifestUrl: `https://raw.githubusercontent.com/${repo}/${branch}/update.json` };
fs.writeFileSync(path.join(root, 'www', 'update-config.json'), `${JSON.stringify(config, null, 2)}\n`);
console.log(`Updater manifest configured for ${repo}.`);
