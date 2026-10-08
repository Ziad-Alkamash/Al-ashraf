import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const assetRoot = join(projectRoot, 'www', 'quran-data');
const pageCount = 604;
const qcfBase = 'https://raw.githubusercontent.com/Ziad-Alkamash/quran-qcf4/main/pages';
const textBase = 'https://api.alquran.cloud/v1/page';
const fontBase = 'https://cdn.jsdelivr.net/gh/Ziad-Alkamash/quran-qcf4@main/fonts-woff2';
const concurrency = 2;

async function fetchWithRetry(url) {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
      if (!response.ok) {
        const error = new Error(`${response.status} ${url}`);
        error.retryAfter = Number(response.headers.get('retry-after')) || 0;
        throw error;
      }
      return response;
    } catch (error) {
      lastError = error;
      const backoff = lastError?.retryAfter ? lastError.retryAfter * 1000 : 1200 * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, Math.min(20000, backoff)));
    }
  }
  throw lastError;
}

async function download(url, relativePath) {
  const response = await fetchWithRetry(url);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const target = join(assetRoot, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes);
  return bytes.byteLength;
}

let nextPage = 1;
let totalBytes = 0;
const fonts = new Set(['QCF4_QBSML']);
const workers = Array.from({ length: concurrency }, async () => {
  while (true) {
    const page = nextPage++;
    if (page > pageCount) return;
    const padded = String(page).padStart(3, '0');
    const qcfPath = join(assetRoot, 'qcf4', 'pages', `${padded}.json`);
    const textPath = join(assetRoot, 'page-text', `page-${padded}.json`);
    const exists = async (path) => access(path).then(() => true, () => false);
    if (await exists(qcfPath) && await exists(textPath)) {
      const json = JSON.parse(await readFile(qcfPath, 'utf8'));
      for (const line of json.lines || []) for (const word of line.words || []) if (word.font) fonts.add(word.font);
      continue;
    }
    const [qcfBytes, textBytes] = await Promise.all([
      fetchWithRetry(`${qcfBase}/${padded}.json`).then(async (response) => {
        const bytes = new Uint8Array(await response.arrayBuffer());
        const json = JSON.parse(new TextDecoder().decode(bytes));
        for (const line of json.lines || []) {
          for (const word of line.words || []) if (word.font) fonts.add(word.font);
        }
        await mkdir(dirname(qcfPath), { recursive: true });
        await writeFile(qcfPath, bytes);
        return bytes.byteLength;
      }),
      download(`${textBase}/${page}/quran-uthmani`, join('page-text', `page-${padded}.json`))
    ]);
    totalBytes += qcfBytes + textBytes;
    if (page % 50 === 0 || page === pageCount) {
      console.log(`Prepared ${page}/${pageCount} pages (${Math.round(totalBytes / 1048576)} MiB)`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
});

await Promise.all(workers);

// Keep verse-to-page navigation aligned with the exact QCF4 pages rendered by
// the reader. The generic Quran text API can place boundary ayahs on a different
// page, which makes audio follow/highlighting jump to a neighboring page.
const ayahPages = Object.create(null);
for (let page = 1; page <= pageCount; page++) {
  const padded = String(page).padStart(3, '0');
  const json = JSON.parse(await readFile(join(assetRoot, 'qcf4', 'pages', `${padded}.json`), 'utf8'));
  for (const line of json.lines || []) {
    for (const word of line.words || []) {
      if (word.type !== 'word' || !word.verse_key || ayahPages[word.verse_key]) continue;
      ayahPages[word.verse_key] = page;
    }
  }
}
await writeFile(join(assetRoot, 'qcf4', 'ayah-pages.json'), JSON.stringify(ayahPages));

for (const font of fonts) {
  const fileBase = font.startsWith('QCF4_Hafs_') ? `${font}_W` : font;
  totalBytes += await download(`${fontBase}/${fileBase}.woff2`, join('qcf4', 'fonts-woff2', `${fileBase}.woff2`));
  console.log(`Prepared font ${fileBase}`);
}
console.log(`Complete: ${pageCount} pages, ${fonts.size} fonts, ${Math.round(totalBytes / 1048576)} MiB`);
