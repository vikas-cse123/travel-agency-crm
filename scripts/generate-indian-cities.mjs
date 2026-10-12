/**
 * Regenerate `apps/web/src/data/indian-cities.json` from the maintained
 * `country-state-city` dataset (city + state tables).
 *
 * Usage (no repo dependency changes; the package is only needed to run this):
 *   1. npm pack country-state-city@3.2.1 --pack-destination /tmp/csc-dl
 *   2. tar -xzf /tmp/csc-dl/country-state-city-3.2.1.tgz -C /tmp/csc-dl/x
 *   3. node scripts/generate-indian-cities.mjs /tmp/csc-dl/x/package
 *
 * Output entries are `{ city, state }` pairs sorted alphabetically by city,
 * plus a small set of legacy spelling aliases (former official names and the
 * historical `Goa` pseudo-city value) so previously stored departure-city
 * values remain selectable. The form stores and submits plain city names, so
 * this file never introduces airport/IATA codes into labels or values.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const packageDir = process.argv[2];
if (!packageDir) {
  console.error('Usage: node scripts/generate-indian-cities.mjs <country-state-city package dir>');
  process.exit(1);
}

const version = JSON.parse(
  readFileSync(join(packageDir, 'package.json'), 'utf8'),
).version;
const cities = JSON.parse(readFileSync(join(packageDir, 'lib/assets/city.json'), 'utf8'));
const states = JSON.parse(readFileSync(join(packageDir, 'lib/assets/state.json'), 'utf8'));

const stateName = new Map();
for (const state of states) {
  if (state.countryCode === 'IN') stateName.set(state.isoCode, state.name);
}

// Deduplicate exact (city, state) rows; drop blank names.
const seen = new Set();
const entries = [];
for (const row of cities) {
  if (row[1] !== 'IN') continue;
  const city = String(row[0]).trim();
  const state = stateName.get(row[2]);
  if (!city || !state) continue;
  const key = `${city}|${state}`;
  if (seen.has(key)) continue;
  seen.add(key);
  entries.push({ city, state });
}

// Legacy aliases for values stored by earlier app versions that the upstream
// dataset only carries under a different spelling (plus the historical `Goa`
// pseudo-city). Kept explicitly so those records stay selectable.
const legacyAliases = [
  { city: 'Bhubaneswar', state: 'Odisha' },
  { city: 'Calicut', state: 'Kerala' },
  { city: 'Goa', state: 'Goa' },
  { city: 'Kochi', state: 'Kerala' },
  { city: 'Mangalore', state: 'Karnataka' },
  { city: 'Nainital', state: 'Uttarakhand' },
  { city: 'Trivandrum', state: 'Kerala' },
];
for (const alias of legacyAliases) {
  const key = `${alias.city}|${alias.state}`;
  if (!seen.has(key)) {
    seen.add(key);
    entries.push(alias);
  }
}

entries.sort(
  (a, b) => a.city.localeCompare(b.city, 'en') || a.state.localeCompare(b.state, 'en'),
);

const distinctStates = new Set(entries.map((entry) => entry.state));
console.log(`country-state-city: ${version}`);
console.log(`entries: ${entries.length}`);
console.log(`distinct states/UTs: ${distinctStates.size}`);
console.log(`legacy aliases: ${legacyAliases.length}`);

const output = {
  source: `country-state-city@${version} (lib/assets/city.json + state.json), plus ${legacyAliases.length} legacy spelling aliases for previously stored values`,
  generatedBy: 'scripts/generate-indian-cities.mjs',
  entries,
};
writeFileSync(
  new URL('../apps/web/src/data/indian-cities.json', import.meta.url),
  `${JSON.stringify(output)}\n`,
);
console.log('wrote apps/web/src/data/indian-cities.json');
