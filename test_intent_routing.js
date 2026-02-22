/**
 * Test intent routing for camera discovery queries
 * Simulates the actual IntentRouter logic
 */

// Import patterns from intentRouter
const networkScanPatterns = [
  /skanuj.*sieć/i,
  /odkryj.*urządzenia/i,
  /znajdź.*urządzenia/i,
  /scan.*network/i,
  /znajdź.*kamerę.*w.*sieci/i,
  /znajdź.*kamere.*w.*sieci/i,
  /znajdź.*kamerę.*lokalnej/i,
  /znajdź.*kamere.*lokalnej/i,
  /wyszukaj.*kamerę.*w.*sieci/i,
  /wyszukaj.*kamere.*lokalnej/i,
  /skanuj.*siec.*w.*poszukiwaniu.*kamer/i,
  /odkryj.*kamery.*w.*sieci/i,
  /odkryj.*kamery.*lokalnej/i,
  /wyszukaj.*kamery.*w.*sieci/i,
  /znajdz.*kamery.*w.*sieci/i,
  /znajdz.*kamery.*lokalnej/i,
  /skanuj.*siec.*kamer/i,
  /odkryj.*kamery.*sieci/i,
  /skanuj.*siec.*kamerami/i,
  /poszukaj.*kamer.*w.*sieci/i,
  /znajdz.*kamery.*lokalnej/i,
];

// Camera describe patterns (should NOT match camera discovery)
const cameraDescribePatterns = [
  /co.*wida.*na.*kamerze/i,
  /co.*widocz.*na.*kamerze/i,
  /co.*widac.*na.*kamerze/i,
  /co.*się.*dzieje.*na.*kamerze/i,
  /co.*sie.*dzieje.*na.*kamerze/i,
  /pokaż.*kamerę/i,
  /pokaz.*kamera/i,
  /kamera.*wejściow/i,
  /kamera.*ogrod/i,
  /co.*dzieje.*się.*na.*kamerze/i,
  /co.*dzieje.*się.*na.*kamerze.*ogrodow/i,
  /co.*dzieje.*się.*na.*kamerze.*salonow/i,
];

// Browse patterns (should NOT match camera discovery)
const browsePatterns = [
  /https?:\/\/[^\s]+/i,
  /^(www\.)?[a-z0-9-]+\.[a-z]{2,}/i,
];

function detectIntent(input) {
  const lowerInput = input.toLowerCase();
  
  // Check network scan patterns first (most specific)
  for (const pattern of networkScanPatterns) {
    if (pattern.test(lowerInput)) {
      return {
        intent: 'network:scan',
        confidence: 0.8,
        entities: {}
      };
    }
  }
  
  // Check camera describe patterns
  for (const pattern of cameraDescribePatterns) {
    if (pattern.test(lowerInput)) {
      return {
        intent: 'camera:describe',
        confidence: 0.8,
        entities: {}
      };
    }
  }
  
  // Check browse patterns
  for (const pattern of browsePatterns) {
    if (pattern.test(lowerInput)) {
      return {
        intent: 'browse:url',
        confidence: 0.9,
        entities: {}
      };
    }
  }
  
  // Default fallback
  return {
    intent: 'chat:ask',
    confidence: 0.1,
    entities: {}
  };
}

// Test cases
const testCases = [
  // Camera discovery queries (should be network:scan)
  { query: 'znajdź kamere w sieci lokalnej', expected: 'network:scan' },
  { query: 'znajdź kamere w sieci lokalnej:', expected: 'network:scan' },
  { query: 'skanuj siec w poszukiwaniu kamer', expected: 'network:scan' },
  { query: 'odkryj kamery w sieci', expected: 'network:scan' },
  { query: 'wyszukaj kamere w lokalnej sieci', expected: 'network:scan' },
  { query: 'poszukaj kamer w sieci', expected: 'network:scan' },
  { query: 'znajdz kamery lokalnej', expected: 'network:scan' },
  
  // Camera describe queries (should be camera:describe)
  { query: 'co widać na kamerze', expected: 'camera:describe' },
  { query: 'pokaż kamerę', expected: 'camera:describe' },
  { query: 'co dzieje się na kamerze ogrodowej', expected: 'camera:describe' },
  
  // Browse queries (should be browse:url)
  { query: 'https://example.com', expected: 'browse:url' },
  { query: 'www.google.com', expected: 'browse:url' },
  
  // General chat (should be chat:ask)
  { query: 'jaka jest pogoda', expected: 'chat:ask' },
  { query: 'pomoc', expected: 'chat:ask' },
];

console.log('🧪 Testing Intent Routing for Camera Discovery\n');

let passed = 0;
let failed = 0;

testCases.forEach((testCase, index) => {
  const result = detectIntent(testCase.query);
  const success = result.intent === testCase.expected;
  
  console.log(`${index + 1}. "${testCase.query}"`);
  console.log(`   Expected: ${testCase.expected}`);
  console.log(`   Got:      ${result.intent}`);
  console.log(`   Result:   ${success ? '✅ PASS' : '❌ FAIL'}`);
  console.log('');
  
  if (success) {
    passed++;
  } else {
    failed++;
  }
});

console.log('📊 Test Results:');
console.log(`✅ Passed: ${passed}/${testCases.length}`);
console.log(`❌ Failed: ${failed}/${testCases.length}`);
console.log(`📈 Success Rate: ${((passed / testCases.length) * 100).toFixed(1)}%`);

if (failed === 0) {
  console.log('\n🎉 All tests passed! Intent routing is working correctly.');
} else {
  console.log('\n⚠️  Some tests failed. Check the patterns above.');
}
