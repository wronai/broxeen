#!/usr/bin/env node

// Quick test to debug intent detection for "znajdź pliki pdf"

const testInputs = [
  'znajdź pliki pdf',
  'znajdź pliki pdf na dysku',
  'przeczytaj plik',
  'lista plików w folderze usera',
];

// Simulate IntentRouter patterns
const fileSearchPatterns = [
  /znajd[źz]\s*plik/i,
  /wyszukaj\s*plik/i,
  /szukaj\s*plik/i,
  /znajd[źz]\s*dokument/i,
  /wyszukaj\s*dokument/i,
  /szukaj\s*dokument/i,
  /plik[iy]?\s+na\s+dysku/i,
  /dokument[yów]?\s+na\s+dysku/i,
  /plik[iy]?\s+w\s+folderze/i,
  /plik[iy]?\s+w\s+katalogu/i,
  /przeczytaj\s+plik/i,
  /odczytaj\s+plik/i,
  /co\s+jest\s+w\s+pliku/i,
  /co\s+zawiera\s+plik/i,
  /otw[óo]rz\s+plik/i,
  /poka[żz]\s+plik/i,
  /file\s*search/i,
  /find\s*file/i,
  /search\s*file/i,
  /lista\s+plik[óo]?w/i,
  /wylistuj\s+plik/i,
  /poka[żz]\s+(mi\s+)?plik[iy]?\s+(w|na)/i,
  /co\s+(jest|mam|znajduje\s+się)\s+(w|na)\s+(folderze|katalogu|dysku)/i,
  /zawarto[śs][ćc]\s+(folderu|katalogu)/i,
  /(folder|katalog)\s+(usera|u[żz]ytkownika|domowy|home)/i,
  /plik[iy]?\s+(usera|u[żz]ytkownika)/i,
  /ls\s+(~|\/home|\/)/i,
  /list\s+(files|directory|folder)/i,
  /przejrzyj\s+(pliki|folder|katalog)/i,
  /wy[śs]wietl\s+plik/i,
];

console.log('🔍 Testing Intent Detection for file:search\n');

for (const input of testInputs) {
  console.log(`Input: "${input}"`);
  let matched = false;
  
  for (let i = 0; i < fileSearchPatterns.length; i++) {
    const pattern = fileSearchPatterns[i];
    if (pattern.test(input)) {
      console.log(`  ✅ MATCH: pattern[${i}] = ${pattern}`);
      matched = true;
      break;
    }
  }
  
  if (!matched) {
    console.log(`  ❌ NO MATCH - would go to fallback`);
  }
  console.log('');
}
