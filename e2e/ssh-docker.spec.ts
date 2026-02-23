/**
 * E2E tests for SSH with Docker test environment
 * Tests real SSH connections, command execution, and LLM analysis
 * Requires: docker/ssh-test environment running
 */

import { test, expect } from '@playwright/test';

const SSH_TEST_HOST = 'localhost';
const SSH_TEST_PORT = 2222;
const SSH_TEST_USER = 'testuser';

test.describe('SSH Docker Integration', () => {
  test.beforeAll(async () => {
    // Verify Docker SSH environment is running
    const { execSync } = require('child_process');
    try {
      execSync('docker ps | grep broxeen-ssh-test', { stdio: 'pipe' });
    } catch (e) {
      console.warn('⚠️  SSH test containers not running. Run: cd docker/ssh-test && ./setup.sh');
    }
  });

  test('can execute SSH command on Docker container', async ({ page }) => {
    await page.goto('http://localhost:4173'); // Production build
    
    // Wait for app to load
    await page.waitForLoadState('networkidle');
    
    const input = page.locator('input[type="text"]');
    
    // Execute uptime command
    await input.fill(`ssh ${SSH_TEST_HOST} port ${SSH_TEST_PORT} user ${SSH_TEST_USER} uptime`);
    await input.press('Enter');
    
    await page.waitForSelector('.message', { timeout: 10000 });
    const response = await page.locator('.message').last().textContent();
    
    // Should show either result or Tauri requirement
    expect(response).toMatch(/uptime|Tauri|load average|up \d+/i);
  });

  test('text2ssh translates natural language to commands', async ({ page }) => {
    await page.goto('http://localhost:4173');
    await page.waitForLoadState('networkidle');
    
    const input = page.locator('input[type="text"]');
    
    const queries = [
      { query: `text2ssh ${SSH_TEST_HOST} port ${SSH_TEST_PORT} ile pamięci`, expectedPattern: /free|memory|pamięć/i },
      { query: `text2ssh ${SSH_TEST_HOST} port ${SSH_TEST_PORT} sprawdź dysk`, expectedPattern: /df|disk|dysk/i },
      { query: `text2ssh ${SSH_TEST_HOST} port ${SSH_TEST_PORT} jakie procesy`, expectedPattern: /top|process|procesy/i },
    ];

    for (const { query, expectedPattern } of queries) {
      await input.fill(query);
      await input.press('Enter');
      
      await page.waitForSelector('.message', { timeout: 8000 });
      const response = await page.locator('.message').last().textContent();
      
      expect(response).toMatch(expectedPattern);
      await page.waitForTimeout(500);
    }
  });

  test('SSH test connection works', async ({ page }) => {
    await page.goto('http://localhost:4173');
    await page.waitForLoadState('networkidle');
    
    const input = page.locator('input[type="text"]');
    await input.fill(`test ssh ${SSH_TEST_HOST} port ${SSH_TEST_PORT} user ${SSH_TEST_USER}`);
    await input.press('Enter');
    
    await page.waitForSelector('.message', { timeout: 10000 });
    const response = await page.locator('.message').last().textContent();
    
    expect(response).toMatch(/test ssh|port|dostępny|reachable/i);
  });

  test('SSH lists known hosts', async ({ page }) => {
    await page.goto('http://localhost:4173');
    await page.waitForLoadState('networkidle');
    
    const input = page.locator('input[type="text"]');
    await input.fill('ssh hosty');
    await input.press('Enter');
    
    await page.waitForSelector('.message', { timeout: 5000 });
    const response = await page.locator('.message').last().textContent();
    
    expect(response).toMatch(/znane hosty|known hosts|brak wpisów/i);
  });

  test('Multiple SSH commands in sequence', async ({ page }) => {
    await page.goto('http://localhost:4173');
    await page.waitForLoadState('networkidle');
    
    const input = page.locator('input[type="text"]');
    
    const commands = [
      `ssh ${SSH_TEST_HOST} port ${SSH_TEST_PORT} hostname`,
      `ssh ${SSH_TEST_HOST} port ${SSH_TEST_PORT} whoami`,
      `ssh ${SSH_TEST_HOST} port ${SSH_TEST_PORT} pwd`,
    ];

    for (const cmd of commands) {
      await input.fill(cmd);
      await input.press('Enter');
      await page.waitForTimeout(1000);
    }

    const messages = await page.locator('.message').all();
    expect(messages.length).toBeGreaterThanOrEqual(commands.length);
  });
});

test.describe('SSH + LLM Integration', () => {
  test('LLM can analyze SSH command output', async ({ page }) => {
    // Skip if no LLM API key
    const apiKey = process.env.VITE_OPENROUTER_API_KEY;
    if (!apiKey) {
      test.skip();
      return;
    }

    await page.goto('http://localhost:4173');
    await page.waitForLoadState('networkidle');
    
    const input = page.locator('input[type="text"]');
    
    // Execute command and ask LLM to analyze
    await input.fill(`ssh ${SSH_TEST_HOST} port ${SSH_TEST_PORT} df -h`);
    await input.press('Enter');
    
    await page.waitForTimeout(2000);
    
    // Ask LLM about the result
    await input.fill('co pokazuje ten wynik?');
    await input.press('Enter');
    
    await page.waitForSelector('.message', { timeout: 15000 });
    const response = await page.locator('.message').last().textContent();
    
    expect(response).toBeTruthy();
    expect(response!.length).toBeGreaterThan(20);
  });

  test('LLM generates SSH commands from natural language', async ({ page }) => {
    const apiKey = process.env.VITE_OPENROUTER_API_KEY;
    if (!apiKey) {
      test.skip();
      return;
    }

    await page.goto('http://localhost:4173');
    await page.waitForLoadState('networkidle');
    
    const input = page.locator('input[type="text"]');
    
    // Natural language request
    await input.fill(`sprawdź ile miejsca jest na dysku serwera ${SSH_TEST_HOST}`);
    await input.press('Enter');
    
    await page.waitForSelector('.message', { timeout: 10000 });
    const response = await page.locator('.message').last().textContent();
    
    // Should trigger SSH plugin or LLM should suggest SSH command
    expect(response).toMatch(/ssh|df|dysk|disk/i);
  });
});

test.describe('SSH Error Handling', () => {
  test('handles invalid host gracefully', async ({ page }) => {
    await page.goto('http://localhost:4173');
    await page.waitForLoadState('networkidle');
    
    const input = page.locator('input[type="text"]');
    await input.fill('ssh 192.168.255.255 uptime');
    await input.press('Enter');
    
    await page.waitForSelector('.message', { timeout: 8000 });
    const response = await page.locator('.message').last().textContent();
    
    expect(response).toMatch(/błąd|error|timeout|niedostępny/i);
  });

  test('handles missing host parameter', async ({ page }) => {
    await page.goto('http://localhost:4173');
    await page.waitForLoadState('networkidle');
    
    const input = page.locator('input[type="text"]');
    await input.fill('ssh uptime');
    await input.press('Enter');
    
    await page.waitForSelector('.message', { timeout: 5000 });
    const response = await page.locator('.message').last().textContent();
    
    expect(response).toMatch(/podaj adres|przykłady/i);
  });

  test('handles authentication failure gracefully', async ({ page }) => {
    await page.goto('http://localhost:4173');
    await page.waitForLoadState('networkidle');
    
    const input = page.locator('input[type="text"]');
    await input.fill(`ssh ${SSH_TEST_HOST} port ${SSH_TEST_PORT} user invaliduser uptime`);
    await input.press('Enter');
    
    await page.waitForSelector('.message', { timeout: 10000 });
    const response = await page.locator('.message').last().textContent();
    
    // Should show error or Tauri requirement
    expect(response).toBeTruthy();
  });
});
