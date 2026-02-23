#!/usr/bin/env node

// Test parseSearchParams for "znajdź pliki pdf"

const input = "znajdź pliki pdf na dysku";
let query = input;
const extensions = [];

// Extract extensions: ".pdf", "pdf", "pliki pdf"
const extPatterns = [
  /\.(\w{2,5})\b/g,
  /(?:pliki?|dokumenty?|format)\s+(\w{2,5})\b/gi,
  /(?:rozszerzenie|ext)\s+(\w{2,5})\b/gi,
];

for (const pattern of extPatterns) {
  let m;
  while ((m = pattern.exec(input)) !== null) {
    const ext = m[1].toLowerCase();
    console.log(`Found potential extension: "${ext}" from pattern: ${pattern}`);
    if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv', 'json', 'xml', 'yaml', 'yml', 'html', 'py', 'ts', 'tsx', 'js', 'rs', 'go', 'java', 'c', 'cpp', 'jpg', 'jpeg', 'png', 'gif', 'svg', 'mp4', 'mp3', 'wav', 'zip', 'tar', 'sql', 'log', 'sh'].includes(ext)) {
      if (!extensions.includes(ext)) extensions.push(ext);
    }
  }
}

console.log('\n✅ Extracted extensions:', extensions);
console.log('Query:', query);
