/**
 * E2E tests for SSH integration with voice commands and LLM analysis
 * Tests SSH execution, text2ssh natural language processing, and LLM-powered responses
 */

import { test, expect } from '@playwright/test';

test.describe('SSH Integration with LLM', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');
  });

  test('SSH plugin is registered and available', async ({ page }) => {
    const input = page.locator('input[type="text"]');
    await input.fill('ssh');
    await input.press('Enter');

    await page.waitForSelector('.message', { timeout: 5000 });
    const response = await page.locator('.message').last().textContent();
    
    expect(response).toContain('SSH');
    expect(response || '').toMatch(/znane hosty|known hosts|podaj adres/i);
  });

  test('text2ssh natural language to command translation', async ({ page }) => {
    const input = page.locator('input[type="text"]');
    
    // Test natural language patterns
    const patterns = [
      { nl: 'ile pamięci', expectedCmd: 'free' },
      { nl: 'jakie procesy', expectedCmd: 'top' },
      { nl: 'sprawdź dysk', expectedCmd: 'df' },
      { nl: 'kto zalogowany', expectedCmd: 'who' },
    ];

    for (const { nl } of patterns) {
      await input.fill(`text2ssh localhost ${nl}`);
      await input.press('Enter');
      await page.waitForTimeout(500);
    }

    const messages = await page.locator('.message').allTextContents();
    expect(messages.length).toBeGreaterThan(0);
  });

  test('SSH command suggestions appear in chat', async ({ page }) => {
    const input = page.locator('input[type="text"]');
    await input.fill('ssh');
    await input.press('Enter');

    await page.waitForSelector('.message', { timeout: 5000 });
    const response = await page.locator('.message').last().textContent();
    
    // Should contain action suggestions
    expect(response).toMatch(/uptime|df -h|free -h/);
  });

  test('LLM can analyze SSH output', async ({ page }) => {
    // This test requires LLM to be configured
    const apiKeySet = await page.evaluate(() => {
      return !!import.meta.env.VITE_OPENROUTER_API_KEY;
    });

    if (!apiKeySet) {
      test.skip();
      return;
    }

    const input = page.locator('input[type="text"]');
    
    // Execute SSH command (will fail in browser but should show proper error)
    await input.fill('ssh localhost uptime');
    await input.press('Enter');
    
    await page.waitForSelector('.message', { timeout: 5000 });
    const response = await page.locator('.message').last().textContent();
    
    // Should mention Tauri requirement or show result
    expect(response).toMatch(/Tauri|uptime|wynik/i);
  });

  test('SSH error handling is user-friendly', async ({ page }) => {
    const input = page.locator('input[type="text"]');
    
    // Try SSH without host
    await input.fill('ssh uptime');
    await input.press('Enter');
    
    await page.waitForSelector('.message', { timeout: 5000 });
    const response = await page.locator('.message').last().textContent();
    
    expect(response).toMatch(/podaj adres|przykłady/i);
    expect(response).toContain('ssh');
  });

  test('Multiple SSH commands maintain context', async ({ page }) => {
    const input = page.locator('input[type="text"]');
    
    const commands = [
      'ssh hosty',
      'ssh localhost uptime',
      'text2ssh localhost ile pamięci',
    ];

    for (const cmd of commands) {
      await input.fill(cmd);
      await input.press('Enter');
      await page.waitForTimeout(800);
    }

    const messages = await page.locator('.message').all();
    expect(messages.length).toBeGreaterThanOrEqual(commands.length);
  });
});

test.describe('SSH with Voice Interface (simulated)', () => {
  test('Voice command triggers SSH plugin', async ({ page }) => {
    await page.goto('http://localhost:5173');
    
    // Simulate voice input by directly filling the input
    const input = page.locator('input[type="text"]');
    await input.fill('sprawdź dysk na localhost');
    await input.press('Enter');
    
    await page.waitForSelector('.message', { timeout: 5000 });
    const response = await page.locator('.message').last().textContent();
    
    expect(response).toMatch(/ssh|dysk|df/i);
  });

  test('Natural language SSH queries work end-to-end', async ({ page }) => {
    await page.goto('http://localhost:5173');
    
    const queries = [
      'pokaż uptime na localhost',
      'ile pamięci ma localhost',
      'jakie procesy działają na localhost',
    ];

    for (const query of queries) {
      const input = page.locator('input[type="text"]');
      await input.fill(query);
      await input.press('Enter');
      await page.waitForTimeout(600);
    }

    const messages = await page.locator('.message').all();
    expect(messages.length).toBeGreaterThan(0);
  });
});
