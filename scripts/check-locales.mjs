import fs from 'node:fs';

const directory = new URL('../src/locales/', import.meta.url);
const files = fs.readdirSync(directory).filter((file) => file.endsWith('.json'));
const english = JSON.parse(fs.readFileSync(new URL('en.json', directory), 'utf8'));
const sourceRoot = new URL('../src/', import.meta.url);

function leafKeys(value, prefix = '') {
  if (Array.isArray(value) || value === null || typeof value !== 'object') return [prefix];
  return Object.entries(value).flatMap(([key, child]) => leafKeys(child, prefix ? `${prefix}.${key}` : key));
}

const reference = new Set(leafKeys(english));
let invalid = false;
for (const file of files) {
  const document = JSON.parse(fs.readFileSync(new URL(file, directory), 'utf8'));
  const keys = new Set(leafKeys(document));
  const missing = [...reference].filter((key) => !keys.has(key));
  const coverage = Math.round(((reference.size - missing.length) / reference.size) * 100);
  console.log(`${file.replace('.json', '').padEnd(6)} ${String(coverage).padStart(3)}%${missing.length ? ` (${missing.length} fallback keys)` : ''}`);
  if (!document || typeof document !== 'object') invalid = true;
}
if (files.length !== 10) {
  console.error(`Expected 10 locale files, found ${files.length}.`);
  invalid = true;
}
const sourceFiles = [];
function collectSourceFiles(directoryUrl) {
  for (const entry of fs.readdirSync(directoryUrl, { withFileTypes: true })) {
    const url = new URL(entry.name, directoryUrl.href.endsWith('/') ? directoryUrl : `${directoryUrl.href}/`);
    if (entry.isDirectory()) collectSourceFiles(new URL(`${url.href}/`));
    else if (/\.(ts|tsx)$/.test(entry.name)) sourceFiles.push(url);
  }
}
collectSourceFiles(sourceRoot);
const forbidden = /copyByLocale|homeCopy|localeCopy|Record<Locale|(?:routeLocale|locale)\s*===\s*['"][^'"]+['"]\s*\?\s*['"]/;
for (const file of sourceFiles) {
  const source = fs.readFileSync(file, 'utf8').replace("locale === 'ar' ? 'rtl' : 'ltr'", '');
  if (forbidden.test(source)) {
    console.error(`Inline locale copy found in ${file.pathname.replace(sourceRoot.pathname, '')}.`);
    invalid = true;
  }
}
if (invalid) process.exit(1);
