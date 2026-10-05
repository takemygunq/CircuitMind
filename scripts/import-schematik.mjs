#!/usr/bin/env node
/**
 * Импорт каталога деталей Schematik (https://www.schematik.io/parts). Запускайте только при наличии разрешения
 * Schematik на загрузку каталога (у автора оно получено письменно). Берёт адреса из публичного sitemap.xml, соблюдает robots.txt (раздел /parts/ открыт),
 * ходит неторопливо (3 запроса параллельно, пауза между ними) и продолжает с места остановки.
 *
 *   node scripts/import-schematik.mjs [--limit N] [--no-images]
 *
 * Результат: library/catalogue/schematik.jsonl (по строке на деталь) и уменьшенные картинки в public/parts/catalogue/.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ORIGIN = 'https://www.schematik.io';
const UA = 'CircuitMind-catalogue-import (respectful crawler; see README)';
const OUT = 'library/catalogue/schematik.jsonl';
const IMG_DIR = 'public/parts/catalogue';
const CONCURRENCY = 3;
const DELAY_MS = 250;
const args = process.argv.slice(2);
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const withImages = !args.includes('--no-images');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

async function get(url, binary = false, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA } });
      if (res.status === 429 || res.status >= 500) {
        await sleep(1500 * (i + 1));
        continue;
      }
      if (!res.ok) return null;
      return binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
    } catch {
      await sleep(1000 * (i + 1));
    }
  }
  return null;
}

/** Данные страницы приходят во встроенном потоке Next.js (RSC): склеиваем и раскодируем его части. */
function rscText(html) {
  return [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:\\.|[^"\\])*)"\]\)<\/script>/gs)]
    .map((m) => {
      try {
        return JSON.parse(`"${m[1]}"`);
      } catch {
        return '';
      }
    })
    .join('');
}

/** Участок текста с парными скобками, начиная с открывающей. */
function balanced(s, start) {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      if (--depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function jsonAfter(text, marker, from = 0) {
  const i = text.indexOf(marker, from);
  if (i < 0) return undefined;
  const raw = balanced(text, i + marker.length - 1);
  try {
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

/** Поток Next.js кладёт вместо пустых значений строку "$undefined". */
const real = (v) => (v && v !== '$undefined' ? v : undefined);

function parsePart(html, url) {
  const ld = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs)]
    .map((m) => {
      try {
        return JSON.parse(m[1]);
      } catch {
        return null;
      }
    })
    .find((j) => j && j['@type'] === 'Product');
  if (!ld) return null;
  const desc = html.match(/<meta name="description" content="([^"]*)"/)?.[1];
  const slug = url.split('/parts/')[1];
  const image = typeof ld.image === 'string' ? ld.image.split('?')[0] : undefined;

  const rsc = rscText(html);
  const pinsRaw = jsonAfter(rsc, '"pins":[', Math.max(0, rsc.indexOf('"pinout":{"partSlug"')));
  const pins = Array.isArray(pinsRaw)
    ? pinsRaw.map((p) => ({
        type: p.type,
        label: p.label,
        voltage: real(p.voltage),
        function: real(p.function),
      }))
    : undefined;
  const offersRaw = jsonAfter(rsc, '"offers":[');
  const offers = Array.isArray(offersRaw)
    ? offersRaw.map((o) => ({
        vendor: o.sourceVendor,
        price: o.price ? Number(o.price) : undefined,
        currency: o.currency,
        availability: o.availability,
        url: o.sourceUrl,
      }))
    : undefined;
  // аналоги — другие детали того же семейства из блока «Alternates»
  const altAt = rsc.indexOf('"id":"part-alternatives"');
  const alternates =
    altAt < 0
      ? undefined
      : [
          ...new Set(
            [
              ...rsc
                .slice(altAt, altAt + 120000)
                .matchAll(/\["\$","li","([^"]+)",\{"className":"relative"/g),
            ].map((m) => m[1]),
          ),
        ]
          .filter((x) => x !== slug)
          .slice(0, 24);
  return {
    slug,
    name: ld.name,
    sku: ld.sku,
    brand: ld.brand?.name,
    category: ld.category,
    description: desc ? decode(desc) : undefined,
    image,
    source: url,
    ...(pins?.length && { pins }),
    ...(offers?.length && { offers }),
    ...(alternates?.length && { alternates }),
  };
}

function saveImage(slug, buf) {
  const tmp = path.join(IMG_DIR, `${slug}.png`);
  const out = path.join(IMG_DIR, `${slug}.jpg`);
  fs.writeFileSync(tmp, buf);
  try {
    // sips есть на macOS; на других системах оставляем исходный PNG
    execFileSync(
      'sips',
      ['-Z', '480', '-s', 'format', 'jpeg', '-s', 'formatOptions', '80', tmp, '--out', out],
      { stdio: 'ignore' },
    );
    fs.rmSync(tmp);
  } catch {
    /* оставили PNG */
  }
}

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  if (withImages) fs.mkdirSync(IMG_DIR, { recursive: true });
  const robots = (await get(`${ORIGIN}/robots.txt`)) ?? '';
  if (/Disallow:\s*\/parts\b/i.test(robots))
    throw new Error('robots.txt закрывает /parts/ — остановка');

  const sitemap = await get(`${ORIGIN}/sitemap.xml`);
  if (!sitemap) throw new Error('sitemap.xml недоступен');
  const urls = [...sitemap.matchAll(/<loc>(https:\/\/www\.schematik\.io\/parts\/[^<]+)<\/loc>/g)]
    .map((m) => m[1])
    .filter((u) => !u.includes('/families/'));
  const done = new Set(
    fs.existsSync(OUT)
      ? fs
          .readFileSync(OUT, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l).slug)
      : [],
  );
  const todo = urls.filter((u) => !done.has(u.split('/parts/')[1])).slice(0, limit);
  console.log(`в sitemap ${urls.length} деталей, уже есть ${done.size}, к загрузке ${todo.length}`);

  let n = 0;
  let failed = 0;
  const out = fs.createWriteStream(OUT, { flags: 'a' });
  async function worker() {
    for (;;) {
      const url = todo.shift();
      if (!url) return;
      const html = await get(url);
      const part = html && parsePart(html, url);
      if (!part) {
        failed++;
        console.warn('пропуск', url);
        continue;
      }
      if (withImages && part.image) {
        const jpg = path.join(IMG_DIR, `${part.slug}.jpg`);
        if (!fs.existsSync(jpg)) {
          const buf = await get(part.image, true);
          if (buf) saveImage(part.slug, buf);
        }
      }
      out.write(JSON.stringify(part) + '\n');
      if (++n % 100 === 0) console.log(`${n} готово, ошибок ${failed}`);
      await sleep(DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  out.end();
  console.log(`готово: ${n} деталей, ошибок ${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
