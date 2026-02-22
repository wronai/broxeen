import { test, expect, Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173";

async function openApp(page: Page) {
    // Pass browser console logs to terminal
    page.on("console", (msg) => console.log(`[Browser] ${msg.type()}: ${msg.text()}`));

    // Mock LLM so we don't hit real OpenRouter during tests
    await page.route("**/openrouter.ai/**", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                choices: [
                    {
                        message: {
                            content: "Mocked Search Result from LLM",
                        },
                    },
                ],
            }),
        });
    });

    await page.goto(BASE_URL);
    await page.waitForSelector("text=Witaj w Broxeen", { timeout: 10000 });
}

test.describe("Chat Features & Interactions", () => {
    test("Search query (? prefix) routes to DuckDuckGo search", async ({ page }) => {
        await openApp(page);

        // Mock DuckDuckGo / AllOrigins / CorsProxy / Jina
        await page.route("**/*", async (route) => {
            const url = route.request().url();
            if (
                url.includes("allorigins.win") ||
                url.includes("corsproxy.io") ||
                url.includes("jina.ai")
            ) {
                if (url.includes("duckduckgo.com")) {
                    await route.fulfill({
                        status: 200,
                        contentType: url.includes("allorigins") ? "application/json" : "text/html",
                        body: url.includes("allorigins") ? JSON.stringify({
                            contents: `<html><body>
                <a class="result__url" href="https://mocked-search-result.com">Mocked Search Result</a>
                <div class="result__snippet">This is a mocked search description snippet.</div>
              </body></html>`,
                        }) : `<html><body>
              <a class="result__url" href="https://mocked-search-result.com">Mocked Search Result</a>
              <div class="result__snippet">This is a mocked search description snippet.</div>
            </body></html>`,
                    });
                } else {
                    await route.fulfill({
                        status: 200,
                        contentType: url.includes("allorigins") ? "application/json" : "text/html",
                        body: url.includes("allorigins") ? JSON.stringify({
                            contents: "<html><body><p>Generic mocked page content</p></body></html>",
                        }) : "<html><body><p>Generic mocked page content</p></body></html>",
                    });
                }
            } else {
                await route.continue();
            }
        });

        const input = page.getByPlaceholder(/Wpisz adres/i);
        await input.fill("? testowe zapytanie");
        await input.press("Enter");

        // Message bubble for user query should show up
        await expect(page.locator("text=? testowe zapytanie").first()).toBeVisible({ timeout: 5000 });

        // The logic should try to search duckduckgo, extract 'Mocked Search Result' snippet, and show an assistant message
        const assistantMessages = page.locator(".bg-gray-800.text-gray-100");
        await expect(assistantMessages.first()).toBeVisible({ timeout: 15000 });

        // Wait for the final text instead of failing immediately on "Wyszukuję..."
        await expect(assistantMessages.first()).toContainText("Mocked Search Result", { timeout: 15000 });
    });

    test("Settings changes are saved", async ({ page }) => {
        await openApp(page);

        // Open settings
        const settingsBtn = page.getByRole("button", { name: /ustawienia|settings/i });
        if (await settingsBtn.count() > 0) {
            await settingsBtn.click();
        } else {
            // If no text button, select by icon class or title if available. In Chat.tsx there's a button for settings
            const btn = page.locator("button[title*='Ustawienia']");
            await btn.click();
        }

        // Modal should appear
        await expect(page.locator("h2:has-text('Ustawienia Audio')")).toBeVisible();

        // Toggle "TTS włączony" text by clicking the checkbox via dispatchEvent to bypass viewport checks
        const ttsCheckbox = page.locator("label").filter({ hasText: "TTS włączony" }).locator("input[type='checkbox']");
        await expect(ttsCheckbox).toBeVisible();

        await ttsCheckbox.dispatchEvent("click"); // toggle, bypassing animation/viewport issues

        // Save
        const saveBtn = page.getByRole("button", { name: /Zapisz ustawienia/i });
        await saveBtn.dispatchEvent("click");

        // Verify "Zapisano" toast appears
        await expect(page.locator("text=✓ Zapisano")).toBeVisible();

        // Close settings
        const closeBtn = page.getByRole("button", { name: "Anuluj" });
        await closeBtn.dispatchEvent("click");

        // Verify modal is gone
        await expect(page.locator("h2:has-text('Ustawienia Audio')")).not.toBeVisible();
    });

    test("Copy context button works via clipboard API", async ({ page, context }) => {
        await context.grantPermissions(["clipboard-read", "clipboard-write"]);
        await openApp(page);

        // Enter a quick message
        const input = page.getByPlaceholder(/Wpisz adres/i);
        await input.fill("Test message for clipboard");
        await input.press("Enter");

        await expect(page.locator("text=Test message for clipboard").first()).toBeVisible();

        // Find the main copy button (Kopiuj zawartość czatu)
        const copyMainBtn = page.getByRole("button", { name: /Kopiuj/i }).first();
        await copyMainBtn.click();

        // Verify clipboard content
        const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
        expect(clipboardText).toContain("Test message for clipboard");
    });
});
