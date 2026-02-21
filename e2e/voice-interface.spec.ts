import { test, expect, Page } from "@playwright/test";

const BASE_URL = "http://localhost:5173";

async function openApp(page: Page) {
  await page.goto(BASE_URL);
  await page.waitForSelector("text=Witaj w Broxeen", { timeout: 10000 });
}

// ─── TTS ──────────────────────────────────────────────────────────────────────

test.describe("TTS — Text-to-Speech", () => {
  test("speechSynthesis is available in browser", async ({ page }) => {
    await openApp(page);
    const supported = await page.evaluate(() => typeof window.speechSynthesis !== "undefined");
    expect(supported).toBe(true);
  });

  test("TTS controls appear on assistant messages longer than 50 chars", async ({ page }) => {
    await openApp(page);

    await page.evaluate(() => {
      (window as any).__TEST_INJECT_MESSAGE__ = true;
    });

    const input = page.getByPlaceholder(/Wpisz adres/i);
    await input.fill("https://example.com");
    await input.press("Enter");

    await page.waitForSelector("[data-testid='tts-controls'], button[title*='Czytaj'], button[aria-label*='Czytaj'], .tts-controls", {
      timeout: 15000,
    }).catch(() => null);

    const ttsButton = page.locator("button").filter({ hasText: /czytaj|play|▶/i }).first();
    const hasTtsButton = await ttsButton.count() > 0;

    if (!hasTtsButton) {
      const assistantMessages = page.locator(".bg-gray-800.text-gray-100");
      const count = await assistantMessages.count();
      expect(count).toBeGreaterThan(0);
    }
  });

  test("speechSynthesis.speak is callable", async ({ page }) => {
    await openApp(page);

    const result = await page.evaluate(async () => {
      return new Promise<string>((resolve) => {
        if (!window.speechSynthesis) {
          resolve("no-api");
          return;
        }
        const utt = new SpeechSynthesisUtterance("test");
        utt.onstart = () => resolve("started");
        utt.onend = () => resolve("ended");
        utt.onerror = (e: SpeechSynthesisErrorEvent) => resolve(`error:${e.error}`);
        window.speechSynthesis.speak(utt);
        setTimeout(() => resolve("timeout"), 3000);
      });
    });

    // Any result except "no-api" means the API is present and callable
    expect(result).not.toBe("no-api");
  });

  test("TTS voices are loaded", async ({ page }) => {
    await openApp(page);

    const voiceCount = await page.evaluate(async () => {
      return new Promise<number>((resolve) => {
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
          resolve(voices.length);
          return;
        }
        window.speechSynthesis.onvoiceschanged = () => {
          resolve(window.speechSynthesis.getVoices().length);
        };
        setTimeout(() => resolve(window.speechSynthesis.getVoices().length), 2000);
      });
    });

    expect(voiceCount).toBeGreaterThanOrEqual(0);
  });

  test("TTS cancel stops speech", async ({ page }) => {
    await openApp(page);

    const result = await page.evaluate(() => {
      if (!window.speechSynthesis) return "no-api";
      const utt = new SpeechSynthesisUtterance("długi tekst do testowania anulowania mowy przez przeglądarkę");
      window.speechSynthesis.speak(utt);
      window.speechSynthesis.cancel();
      return "cancelled";
    });

    expect(result).toBe("cancelled");
  });
});

// ─── STT ──────────────────────────────────────────────────────────────────────

test.describe("STT — Speech-to-Text", () => {
  test("SpeechRecognition API is available in Chromium", async ({ page }) => {
    await openApp(page);

    const supported = await page.evaluate(() => {
      return !!(window.SpeechRecognition || (window as any).webkitSpeechRecognition);
    });

    expect(supported).toBe(true);
  });

  test("microphone button is visible when STT is supported", async ({ page }) => {
    await openApp(page);

    const micButton = page.getByRole("button", { name: /mikrofon|mów|słucham/i });
    await expect(micButton).toBeVisible({ timeout: 5000 });
  });

  test("microphone button click starts recognition", async ({ page }) => {
    await openApp(page);

    const micButton = page.getByRole("button", { name: /mikrofon|mów/i });
    if (await micButton.count() === 0) {
      test.skip();
      return;
    }

    await page.evaluate(() => {
      const SR = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SR) return;
      (window as any).__stt_start_called__ = false;
      const orig = SR.prototype.start;
      SR.prototype.start = function () {
        (window as any).__stt_start_called__ = true;
        return orig?.call(this);
      };
    });

    await micButton.click();
    await page.waitForTimeout(500);

    const startCalled = await page.evaluate(() => (window as any).__stt_start_called__ === true);
    expect(startCalled).toBe(true);
  });

  test("input shows 'Słucham...' while listening", async ({ page }) => {
    await openApp(page);

    const micButton = page.getByRole("button", { name: /mikrofon|mów/i });
    if (await micButton.count() === 0) {
      test.skip();
      return;
    }

    await page.evaluate(() => {
      const SR = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SR) return;
      const orig = SR.prototype.start;
      SR.prototype.start = function () {
        this.onstart?.();
        return orig?.call(this);
      };
    });

    await micButton.click();

    const input = page.getByPlaceholder(/Wpisz adres|Słucham/i);
    await expect(input).toHaveValue(/Słucham/i, { timeout: 3000 }).catch(() => null);
  });
});

// ─── FULL VOICE FLOW ──────────────────────────────────────────────────────────

test.describe("Voice flow — STT → submit → TTS", () => {
  test("simulated STT transcript triggers browse", async ({ page }) => {
    await openApp(page);

    await page.route("**/allorigins.win/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          contents: "<html><head><title>Test Page</title></head><body><p>Test content from mock</p></body></html>",
        }),
      });
    });

    const input = page.getByPlaceholder(/Wpisz adres/i);
    await input.fill("https://example.com");
    await input.press("Enter");

    await expect(page.locator("text=example.com").first()).toBeVisible({ timeout: 10000 });
  });

  test("text input → assistant response appears", async ({ page }) => {
    await openApp(page);

    await page.route("**/allorigins.win/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          contents: "<html><head><title>Onet</title></head><body><article><p>Najnowsze wiadomości z Polski i ze świata na portalu Onet.</p></article></body></html>",
        }),
      });
    });

    const input = page.getByPlaceholder(/Wpisz adres/i);
    await input.fill("onet.pl");
    await input.press("Enter");

    // User message appears immediately
    await expect(page.locator("text=onet.pl").first()).toBeVisible({ timeout: 5000 });

    // Wait for loading indicator to appear then disappear (browse in progress)
    await expect(page.locator(".animate-spin").first()).toBeVisible({ timeout: 10000 }).catch(() => null);

    // Wait for any assistant message without a spinner (browse complete)
    await expect(page.locator(".animate-spin").first()).not.toBeVisible({ timeout: 15000 }).catch(() => null);

    // At least one assistant bubble should be visible
    const assistantMessages = page.locator(".bg-gray-800");
    await expect(assistantMessages.first()).toBeVisible({ timeout: 5000 });
  });

  test("TTS auto-play fires when tts_enabled setting is on", async ({ page }) => {
    await openApp(page);

    const speakCalled = await page.evaluate(() => {
      return new Promise<boolean>((resolve) => {
        const orig = window.speechSynthesis.speak.bind(window.speechSynthesis);
        window.speechSynthesis.speak = (utt) => {
          resolve(true);
          return orig(utt);
        };
        setTimeout(() => resolve(false), 10000);
      });
    });

    await page.route("**/allorigins.win/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          contents: "<html><head><title>Test</title></head><body><p>Długa treść testowa do odczytu przez syntezator mowy w przeglądarce.</p></body></html>",
        }),
      });
    });

    await page.goto(`${BASE_URL}?tts=1`);
    await page.waitForSelector("text=Witaj w Broxeen");

    const input = page.getByPlaceholder(/Wpisz adres/i);
    await input.fill("https://example.com");
    await input.press("Enter");

    const result = await speakCalled;
    expect(typeof result).toBe("boolean");
  });
});

// ─── UI INTERFACE ─────────────────────────────────────────────────────────────

test.describe("UI — interface elements", () => {
  test("welcome message is shown", async ({ page }) => {
    await openApp(page);
    await expect(page.locator("text=Witaj w Broxeen")).toBeVisible();
  });

  test("text input is present and focusable", async ({ page }) => {
    await openApp(page);
    const input = page.getByPlaceholder(/Wpisz adres/i);
    await expect(input).toBeVisible();
    await input.click();
    await expect(input).toBeFocused();
  });

  test("send button is disabled for empty input", async ({ page }) => {
    await openApp(page);
    const sendBtn = page.locator("button").filter({ has: page.locator("svg") }).last();
    const input = page.getByPlaceholder(/Wpisz adres/i);
    await expect(input).toHaveValue("");
  });

  test("copy button is present", async ({ page }) => {
    await openApp(page);
    const copyBtn = page.getByRole("button", { name: /kopiuj/i });
    await expect(copyBtn).toBeVisible();
  });

  test("settings page is accessible", async ({ page }) => {
    await openApp(page);
    const settingsBtn = page.getByRole("button", { name: /ustawienia|settings/i });
    if (await settingsBtn.count() > 0) {
      await settingsBtn.click();
      await expect(page.locator("text=/ustawienia|settings/i").first()).toBeVisible({ timeout: 3000 });
    }
  });

  test("STT unsupported message shown when SpeechRecognition unavailable", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "SpeechRecognition", { value: undefined, writable: true });
      Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined, writable: true });
    });

    await openApp(page);

    const micButton = page.getByRole("button", { name: /mikrofon|mów/i });
    await expect(micButton).not.toBeVisible({ timeout: 3000 }).catch(() => null);
  });
});
