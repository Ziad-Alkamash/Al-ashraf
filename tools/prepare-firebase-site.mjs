import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'www');
const publicDir = path.join(root, 'firebase-public');
const qcfDir = path.join(publicDir, 'quran-data', 'qcf4');
const pageDir = path.join(qcfDir, 'pages');
const fontDir = path.join(qcfDir, 'fonts-woff2');
const pageTextDir = path.join(publicDir, 'quran-data', 'page-text');
const qcfRepo = 'https://raw.githubusercontent.com/Ziad-Alkamash/quran-qcf4/main';
const fontRepo = 'https://cdn.jsdelivr.net/gh/Ziad-Alkamash/quran-qcf4@main/fonts-woff2';
const totalPages = 604;
const concurrency = 8;

function replaceExactlyOnce(source, from, to, file) {
  const first = source.indexOf(from);
  if (first < 0 || source.indexOf(from, first + from.length) >= 0) {
    throw new Error(`Expected one patch point in ${file}; source may have changed.`);
  }
  return source.slice(0, first) + to + source.slice(first + from.length);
}

async function patchFirebaseOnlyAppCopies() {
  const firebaseHostCheck = `!window.QuranOffline?.isNativeReady?.() &&
      ['almushaf-alashraf-b284b.web.app', 'almushaf-alashraf-b284b.firebaseapp.com'].includes(location.hostname)`;

  const apiPath = path.join(publicDir, 'quran-api.js');
  let api = await fs.readFile(apiPath, 'utf8');
  api = replaceExactlyOnce(
    api,
    'return `${BASE}/page/${pageNumber}/quran-uthmani`;',
    `if (!window.QuranOffline?.isNativeReady?.() &&
      ['almushaf-alashraf-b284b.web.app', 'almushaf-alashraf-b284b.firebaseapp.com'].includes(location.hostname)) {
      return new URL('/quran-data/page-text/' + String(pageNumber).padStart(3, '0') + '.json', location.origin).href;
    }
    return BASE + '/page/' + pageNumber + '/quran-uthmani';`,
    'quran-api.js'
  );
  api = replaceExactlyOnce(
    api,
    'data = await cachedFetchJSON(`${BASE}/page/${pageNumber}/quran-uthmani`);',
    'data = await cachedFetchJSON(pageURL(pageNumber));',
    'quran-api.js'
  );
  api = replaceExactlyOnce(
    api,
    'const remoteUrl = `https://raw.githubusercontent.com/Ziad-Alkamash/quran-qcf4/main/pages/${p}.json`;',
    `const remoteUrl = ${firebaseHostCheck}
      ? new URL(\`/quran-data/qcf4/pages/\${p}.json\`, location.origin).href
      : \`https://raw.githubusercontent.com/Ziad-Alkamash/quran-qcf4/main/pages/\${p}.json\`;`,
    'quran-api.js'
  );
  await fs.writeFile(apiPath, api);

  const appPath = path.join(publicDir, 'app.js');
  let app = await fs.readFile(appPath, 'utf8');
  app = replaceExactlyOnce(
    app,
    "const QCF4_FONT_BASE_REMOTE = 'https://cdn.jsdelivr.net/gh/Ziad-Alkamash/quran-qcf4@main/fonts-woff2/';",
    `const QCF4_FONT_BASE_REMOTE = ${firebaseHostCheck}
    ? \`\${location.origin}/quran-data/qcf4/fonts-woff2/\`
    : 'https://cdn.jsdelivr.net/gh/Ziad-Alkamash/quran-qcf4@main/fonts-woff2/';`,
    'app.js'
  );
  await fs.writeFile(appPath, app);

  const swPath = path.join(publicDir, 'sw.js');
  let sw = await fs.readFile(swPath, 'utf8');
  const cacheMatch = sw.match(/const CACHE_NAME = 'mushaf-ashraf-v(\d+)';/);
  if (!cacheMatch) throw new Error('Could not find the Firebase app-shell cache version in sw.js.');
  // A new deployment must activate a fresh app-shell cache so existing Firebase
  // installs do not keep the old quran-api.js after a hosting-only update.
  sw = sw.replace(cacheMatch[0], `const CACHE_NAME = 'mushaf-ashraf-deploy-${Date.now()}';`);
  sw = replaceExactlyOnce(
    sw,
    '  // Always prefer the files bundled in the installed APK for the app shell.',
    `  // Firebase-hosted Quran assets are cached separately from the app shell.
  if (reqURL.origin === self.location.origin && reqURL.pathname.startsWith('/quran-data/')) {
    event.respondWith(caches.open(API_CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) return cached;
      try {
        const response = await swFetchWithTimeout(event.request, 20000);
        if (response && response.ok) {
          try { await cache.put(event.request, response.clone()); } catch (_) {}
        }
        return response;
      } catch (_) {
        return cached || new Response('Quran asset unavailable offline', { status: 503 });
      }
    }));
    return;
  }

  // Always prefer the files bundled in the installed APK for the app shell.`,
    'sw.js'
  );
  await fs.writeFile(swPath, sw);
}

async function fetchAndWrite(task) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(task.url, { signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (task.type === 'json') {
        const data = JSON.parse(buffer.toString('utf8'));
        if (!Array.isArray(data.lines) || data.lines.length === 0) throw new Error('Invalid QCF page data');
      } else if (task.type === 'page-text') {
        const data = JSON.parse(buffer.toString('utf8'));
        if (data.code !== 200 || !Array.isArray(data.data?.ayahs) || data.data.ayahs.length === 0) throw new Error('Invalid Quran page text data');
      } else if (buffer.length < 4 || buffer.toString('ascii', 0, 4) !== 'wOF2') {
        throw new Error('Invalid WOFF2 font data');
      }
      await fs.writeFile(task.destination, buffer);
      return buffer.length;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw new Error(`Failed to prepare ${task.destination}: ${lastError?.message || 'unknown error'}`);
}

async function main() {
  await fs.rm(publicDir, { recursive: true, force: true });
  await fs.cp(sourceDir, publicDir, { recursive: true });
  await Promise.all([fs.mkdir(pageDir, { recursive: true }), fs.mkdir(fontDir, { recursive: true }), fs.mkdir(pageTextDir, { recursive: true })]);

  const tasks = [];
  for (let page = 1; page <= totalPages; page += 1) {
    const padded = String(page).padStart(3, '0');
    tasks.push({
      type: 'json',
      url: `${qcfRepo}/pages/${padded}.json`,
      destination: path.join(pageDir, `${padded}.json`)
    });
    tasks.push({
      type: 'page-text',
      url: `https://api.alquran.cloud/v1/page/${page}/quran-uthmani`,
      destination: path.join(pageTextDir, `${padded}.json`)
    });
  }
  for (let font = 1; font <= 47; font += 1) {
    const name = `QCF4_Hafs_${String(font).padStart(2, '0')}_W.woff2`;
    tasks.push({ type: 'font', url: `${fontRepo}/${name}`, destination: path.join(fontDir, name) });
  }
  tasks.push({ type: 'font', url: `${fontRepo}/QCF4_QBSML.woff2`, destination: path.join(fontDir, 'QCF4_QBSML.woff2') });

  let next = 0;
  let completed = 0;
  let totalBytes = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= tasks.length) return;
      totalBytes += await fetchAndWrite(tasks[index]);
      completed += 1;
      if (completed % 100 === 0 || completed === tasks.length) {
        console.log(`Prepared ${completed}/${tasks.length} Quran assets.`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  await patchFirebaseOnlyAppCopies();
  console.log(`Firebase hosting output ready: ${tasks.length} Quran assets, ${(totalBytes / (1024 * 1024)).toFixed(1)} MiB.`);
  console.log('The Android/iOS package source remains www/; generated assets exist only in firebase-public/.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
