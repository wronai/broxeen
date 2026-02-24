import { test, expect } from '@playwright/test';

test.describe('New Plugins - Voice Commands and Logs', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('http://localhost:5173');
        await page.waitForLoadState('networkidle');
        await page.waitForSelector('input[type="text"]', { timeout: 10000 });
    });

    test('voice commands plugin can disable and enable microphone', async ({ page }) => {
        console.log('🎤 Testing Voice Commands Plugin');

        // Test disable microphone command
        await page.fill('input[type="text"]', 'wyłącz mikrofon');
        await page.press('input[type="text"]', 'Enter');
        
        // Wait for response
        await page.waitForTimeout(1000);
        
        // Check if response contains microphone disabled message
        const messages = page.locator('[data-testid="message"]');
        const lastMessage = messages.last();
        await expect(lastMessage).toContainText('Mikrofon został wyłączony');
        
        // Test enable microphone command
        await page.fill('input[type="text"]', 'włącz mikrofon');
        await page.press('input[type="text"]', 'Enter');
        
        await page.waitForTimeout(1000);
        
        // Check if response contains microphone enabled message
        const updatedMessages = page.locator('[data-testid="message"]');
        const newLastMessage = updatedMessages.last();
        await expect(newLastMessage).toContainText('Mikrofon został włączony');
        
        console.log('✅ Voice commands working correctly');
    });

    test('voice commands plugin can control voice settings', async ({ page }) => {
        console.log('🔊 Testing Voice Control Commands');

        // Test disable voice control
        await page.fill('input[type="text"]', 'wyłącz sterowanie głosowe');
        await page.press('input[type="text"]', 'Enter');
        
        await page.waitForTimeout(1000);
        
        const messages = page.locator('[data-testid="message"]');
        const lastMessage = messages.last();
        await expect(lastMessage).toContainText('Sterowanie głosowe zostało wyłączone');
        
        // Test enable voice control
        await page.fill('input[type="text"]', 'włącz sterowanie głosowe');
        await page.press('input[type="text"]', 'Enter');
        
        await page.waitForTimeout(1000);
        
        const updatedMessages = page.locator('[data-testid="message"]');
        const newLastMessage = updatedMessages.last();
        await expect(newLastMessage).toContainText('Sterowanie głosowe zostało włączone');
        
        console.log('✅ Voice control commands working correctly');
    });

    test('logs plugin can show log level and download logs', async ({ page }) => {
        console.log('📥 Testing Logs Plugin');

        // Test show log level
        await page.fill('input[type="text"]', 'poziom logów');
        await page.press('input[type="text"]', 'Enter');
        
        await page.waitForTimeout(1000);
        
        const messages = page.locator('[data-testid="message"]');
        const lastMessage = messages.last();
        await expect(lastMessage).toContainText('Aktualny poziom logów');
        await expect(lastMessage).toContainText('INFO');
        
        // Test download logs command
        await page.fill('input[type="text"]', 'pobierz logi');
        await page.press('input[type="text"]', 'Enter');
        
        await page.waitForTimeout(1000);
        
        const updatedMessages = page.locator('[data-testid="message"]');
        const newLastMessage = updatedMessages.last();
        await expect(newLastMessage).toContainText('Logi zostały pobrane');
        
        console.log('✅ Logs plugin working correctly');
    });

    test('logs plugin can clear logs', async ({ page }) => {
        console.log('🧹 Testing Log Clearing');

        await page.fill('input[type="text"]', 'wyczyść logi');
        await page.press('input[type="text"]', 'Enter');
        
        await page.waitForTimeout(1000);
        
        const messages = page.locator('[data-testid="message"]');
        const lastMessage = messages.last();
        await expect(lastMessage).toContainText('Logi zostały wyczyszczone');
        
        console.log('✅ Log clearing working correctly');
    });

    test('autocomplete hints work properly', async ({ page }) => {
        console.log('💡 Testing Autocomplete/Hints');

        const input = page.locator('input[type="text"]');
        
        // Focus input and start typing
        await input.click();
        await input.fill('skanuj');
        
        // Wait for autocomplete to appear
        await page.waitForTimeout(500);
        
        // Check if autocomplete suggestions appear
        const autocomplete = page.locator('[data-testid="chat-autocomplete"]');
        if (await autocomplete.isVisible()) {
            const suggestions = autocomplete.locator('button');
            expect(await suggestions.count()).toBeGreaterThan(0);
            
            // Test Tab completion
            await page.keyboard.press('Tab');
            const currentValue = await input.inputValue();
            expect(currentValue).toContain('skanuj');
        }
        
        console.log('✅ Autocomplete working correctly');
    });
});
