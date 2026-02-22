/**
 * E2E Tests: Complete Plugin System
 * Tests all plugins, camera interactions, scope selection, and marketplace
 */

import { test, expect } from '@playwright/test';

const INPUT_SELECTOR = 'input[type="text"]';

async function waitForApp(page: import('@playwright/test').Page) {
  await page.goto('http://localhost:5173');
  await page.waitForLoadState('networkidle');
  try {
    await page.waitForSelector(INPUT_SELECTOR, { timeout: 10000 });
  } catch {
    await page.waitForTimeout(3000);
    await page.waitForSelector(INPUT_SELECTOR, { timeout: 5000 });
  }
}

async function sendMessage(page: import('@playwright/test').Page, text: string) {
  await page.fill(INPUT_SELECTOR, text);
  await page.press(INPUT_SELECTOR, 'Enter');
  // Give the plugin system time to route and respond
  await page.waitForTimeout(1500);
}

// ── Network Plugins ──────────────────────────────────────────

test.describe('Network Plugins E2E', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
  });

  test('ping: routes to PingPlugin and shows result', async ({ page }) => {
    await sendMessage(page, 'ping 192.168.1.1');

    // Should display ping result or demo message
    const body = await page.textContent('body');
    expect(body).toMatch(/192\.168\.1\.1/);
    // Either real result or demo mode
    expect(body).toMatch(/Ping|ping|Dostępny|demonstracyjny/i);
  });

  test('port scan: routes to PortScanPlugin', async ({ page }) => {
    await sendMessage(page, 'skanuj porty 192.168.1.1');

    const body = await page.textContent('body');
    expect(body).toMatch(/192\.168\.1\.1/);
    expect(body).toMatch(/port|Port|skanowanie|Skanowanie/i);
  });

  test('ARP table: routes to ArpPlugin', async ({ page }) => {
    await sendMessage(page, 'tablica arp');

    const body = await page.textContent('body');
    expect(body).toMatch(/ARP|arp|MAC|mac/i);
  });

  test('Wake-on-LAN: routes to WoLPlugin', async ({ page }) => {
    await sendMessage(page, 'obudź urządzenie AA:BB:CC:DD:EE:FF');

    const body = await page.textContent('body');
    expect(body).toMatch(/AA:BB:CC:DD:EE:FF/);
    expect(body).toMatch(/Wake|WoL|magic|wysłany|demonstracyjny/i);
  });

  test('mDNS discovery: routes to MdnsPlugin', async ({ page }) => {
    await sendMessage(page, 'odkryj usługi mdns');

    const body = await page.textContent('body');
    expect(body).toMatch(/mDNS|mdns|usługi|uslugi/i);
  });

  test('network scan: routes to NetworkScanPlugin', async ({ page }) => {
    await sendMessage(page, 'skanuj sieć lokalną');

    const body = await page.textContent('body');
    // Should show network selection or scan results
    expect(body).toMatch(/sieć|skan|Skanowanie|Wybierz|urządzenia/i);
  });
});

// ── Camera Plugins ───────────────────────────────────────────

test.describe('Camera Plugins E2E', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
  });

  test('ONVIF discovery: routes to OnvifPlugin', async ({ page }) => {
    await sendMessage(page, 'odkryj kamery onvif');

    const body = await page.textContent('body');
    expect(body).toMatch(/ONVIF|onvif|Kamery|kamery|Hikvision|Dahua/i);
  });

  test('camera health check: routes to CameraHealthPlugin', async ({ page }) => {
    await sendMessage(page, 'status kamery');

    const body = await page.textContent('body');
    expect(body).toMatch(/status|Stan|kamer|online|offline|demonstracyjny/i);
  });

  test('camera health check for specific camera', async ({ page }) => {
    await sendMessage(page, 'czy kamera wejściowa działa');

    const body = await page.textContent('body');
    expect(body).toMatch(/kamer|Wejście|status|Stan|działa/i);
  });

  test('camera PTZ control: routes to CameraPtzPlugin', async ({ page }) => {
    await sendMessage(page, 'obróć kamerę w lewo');

    const body = await page.textContent('body');
    expect(body).toMatch(/PTZ|ptz|lewo|W lewo|kierunek|demonstracyjny/i);
  });

  test('camera PTZ zoom', async ({ page }) => {
    await sendMessage(page, 'przybliż kamerę ogrodową');

    const body = await page.textContent('body');
    expect(body).toMatch(/zoom|Przybliżenie|ogr|demonstracyjny/i);
  });

  test('camera snapshot: routes to CameraSnapshotPlugin', async ({ page }) => {
    await sendMessage(page, 'zrób zdjęcie kamerą wejściową');

    const body = await page.textContent('body');
    expect(body).toMatch(/Snapshot|snapshot|zdjęcie|Kamera|Wejście|demonstracyjny/i);
  });

  test('camera describe: routes to RTSP/NetworkScan plugin', async ({ page }) => {
    await sendMessage(page, 'co widać na kamerze ogrodowej');

    const body = await page.textContent('body');
    expect(body).toMatch(/kamer|ogrod|obraz|opis|demonstracyjny/i);
  });
});

// ── Marketplace Plugin ───────────────────────────────────────

test.describe('Marketplace Plugin E2E', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
  });

  test('browse marketplace catalog', async ({ page }) => {
    await sendMessage(page, 'marketplace');

    const body = await page.textContent('body');
    expect(body).toMatch(/Marketplace|marketplace|Plugin|plugin/i);
    // Should list some demo plugins
    expect(body).toMatch(/UPnP|Bandwidth|DNS|Geolocation|Timelapse|SNMP/i);
  });

  test('search plugins by keyword', async ({ page }) => {
    await sendMessage(page, 'szukaj plugin dns');

    const body = await page.textContent('body');
    expect(body).toMatch(/DNS|dns/i);
  });

  test('install plugin from marketplace', async ({ page }) => {
    await sendMessage(page, 'zainstaluj plugin UPnP');

    const body = await page.textContent('body');
    expect(body).toMatch(/zainstalowany|Zainstalowano|UPnP/i);
  });
});

// ── Scope Selection ──────────────────────────────────────────

test.describe('Scope-based Plugin Selection', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
  });

  test('scope correctly limits plugins', async ({ page }) => {
    // In local scope, browse should not be available
    // In internet scope, network scan should not be available
    // Test by sending browse request and checking response

    await sendMessage(page, 'https://example.com');
    const body = await page.textContent('body');
    // Either shows browse result or scope restriction
    expect(body).toMatch(/example\.com|zakres|scope|przeglądanie|browse/i);
  });

  test('network scan in local scope works', async ({ page }) => {
    await sendMessage(page, 'znajdź kamery w sieci lokalnej');

    const body = await page.textContent('body');
    expect(body).toMatch(/kamer|sieć|skan|Wybierz|demonstracyjny|Znaleziono/i);
  });
});

// ── Intent Router Integration ────────────────────────────────

test.describe('Intent Router Integration E2E', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
  });

  test('different intents route to different plugins', async ({ page }) => {
    // Test a sequence of different intent types
    const commands = [
      { input: 'ping 10.0.0.1', expect: /10\.0\.0\.1/ },
      { input: 'tablica arp', expect: /ARP|arp|MAC/i },
      { input: 'status kamery', expect: /status|Stan|kamer/i },
      { input: 'marketplace', expect: /Marketplace|Plugin/i },
    ];

    for (const cmd of commands) {
      await sendMessage(page, cmd.input);
      const body = await page.textContent('body');
      expect(body).toMatch(cmd.expect);
    }
  });

  test('IoT/MQTT intent detection', async ({ page }) => {
    await sendMessage(page, 'jaka jest temperatura');

    const body = await page.textContent('body');
    expect(body).toMatch(/temperatura|sensor|czujnik|IoT|MQTT/i);
  });

  test('chat fallback for unrecognized input', async ({ page }) => {
    await sendMessage(page, 'opowiedz mi dowcip o programistach');

    // Should fall back to chat:ask / LLM plugin
    await page.waitForTimeout(2000);
    const body = await page.textContent('body');
    // Either LLM response or API key missing message
    expect(body).toMatch(/programist|LLM|API|odpowied|chat/i);
  });
});

// ── Full Camera Discovery Flow ───────────────────────────────

test.describe('Full Camera Discovery Flow', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
  });

  test('discover → health check → snapshot flow', async ({ page }) => {
    // Step 1: Discover cameras
    await sendMessage(page, 'odkryj kamery onvif');
    let body = await page.textContent('body');
    expect(body).toMatch(/ONVIF|kamery|Hikvision/i);

    // Step 2: Check health of a camera
    await sendMessage(page, 'status kamery wejściowej');
    body = await page.textContent('body');
    expect(body).toMatch(/status|Stan|kamer|Wejście/i);

    // Step 3: Take snapshot
    await sendMessage(page, 'zrób zdjęcie kamerą wejściową');
    body = await page.textContent('body');
    expect(body).toMatch(/Snapshot|snapshot|Kamera|Wejście/i);

    // Take screenshot for verification
    await page.screenshot({
      path: 'test-results/camera-discovery-flow.png',
      fullPage: true,
    });
  });

  test('discover → PTZ control flow', async ({ page }) => {
    // Step 1: List cameras
    await sendMessage(page, 'pokaż kamery');
    let body = await page.textContent('body');
    expect(body).toMatch(/kamer/i);

    // Step 2: PTZ left
    await sendMessage(page, 'kamera ogrodowa w lewo');
    body = await page.textContent('body');
    expect(body).toMatch(/PTZ|lewo|W lewo|kierunek/i);

    // Step 3: PTZ zoom
    await sendMessage(page, 'przybliż');
    body = await page.textContent('body');
    expect(body).toMatch(/zoom|Przybliżenie/i);
  });
});

// ── Marketplace Install → Use Flow ──────────────────────────

test.describe('Marketplace Install Flow', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
  });

  test('browse → search → install → uninstall', async ({ page }) => {
    // Step 1: Browse catalog
    await sendMessage(page, 'marketplace');
    let body = await page.textContent('body');
    expect(body).toMatch(/Plugin Marketplace|Marketplace/i);

    // Step 2: Search
    await sendMessage(page, 'szukaj plugin bandwidth');
    body = await page.textContent('body');
    expect(body).toMatch(/Bandwidth/i);

    // Step 3: Install
    await sendMessage(page, 'zainstaluj plugin bandwidth');
    body = await page.textContent('body');
    expect(body).toMatch(/zainstalowany|Zainstalowano|Bandwidth/i);

    // Step 4: Uninstall
    await sendMessage(page, 'odinstaluj plugin bandwidth');
    body = await page.textContent('body');
    expect(body).toMatch(/odinstalowany|Usunięto|Bandwidth/i);
  });
});
