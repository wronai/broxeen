/**
 * AutoConfig — Runs at app startup to detect available capabilities
 * and generate interactive setup prompts for missing configuration.
 */

import { configStore } from './configStore';
import { buildApiKeyPrompt, buildNetworkConfigPrompt, buildConfigOverviewPrompt } from '../components/ChatConfigPrompt';
import type { ConfigPromptData } from '../components/ChatConfigPrompt';
import { logger } from '../lib/logger';

const autoConfigLogger = logger.scope('config:auto');

export interface AutoConfigResult {
  /** Whether any critical config is missing */
  needsSetup: boolean;
  /** Welcome/status message text (markdown) */
  messageText: string;
  /** Interactive prompt data for the chat UI */
  prompt?: ConfigPromptData;
  /** Detected capabilities summary */
  capabilities: {
    llmAvailable: boolean;
    sttAvailable: boolean;
    tauriAvailable: boolean;
    networkDetected: string | null;
  };
}

/**
 * Run auto-configuration detection.
 * Call this once after app bootstrap to determine what's available
 * and what the user needs to configure.
 */
export async function runAutoConfig(): Promise<AutoConfigResult> {
  autoConfigLogger.info('Running auto-configuration detection...');

  const status = configStore.getConfigStatus();
  const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI__;

  // Detect network subnet
  let detectedSubnet: string | null = null;
  if (isTauri) {
    try {
      const { invoke } = (window as any).__TAURI__.core;
      const interfaces = await invoke('list_network_interfaces') as Array<[string, string]>;
      if (interfaces.length === 1) {
        const [, ip] = interfaces[0];
        detectedSubnet = ip.split('.').slice(0, 3).join('.');
        autoConfigLogger.info('Detected subnet via Tauri', { subnet: detectedSubnet });
        // Auto-save detected subnet
        configStore.set('network.defaultSubnet', detectedSubnet);
      }
    } catch (err) {
      autoConfigLogger.warn('Tauri network detection failed', err);
    }
  }

  const capabilities = {
    llmAvailable: status.llmConfigured,
    sttAvailable: status.sttConfigured,
    tauriAvailable: isTauri,
    networkDetected: detectedSubnet,
  };

  autoConfigLogger.info('Auto-config complete', capabilities);

  // Build the appropriate prompt
  if (!status.llmConfigured) {
    return {
      needsSetup: true,
      messageText: buildWelcomeMessage(capabilities, true),
      prompt: buildApiKeyPrompt(),
      capabilities,
    };
  }

  return {
    needsSetup: false,
    messageText: buildWelcomeMessage(capabilities, false),
    prompt: buildConfigOverviewPrompt(),
    capabilities,
  };
}

function buildWelcomeMessage(
  caps: AutoConfigResult['capabilities'],
  needsSetup: boolean,
): string {
  const lines: string[] = [];

  if (needsSetup) {
    lines.push('👋 **Witaj w Broxeen!**\n');
    lines.push('Aby w pełni korzystać z aplikacji, skonfiguruj klucz API.\n');
    lines.push('**Status:**');
    lines.push(`- AI / LLM: ${caps.llmAvailable ? '✅ Skonfigurowane' : '❌ Brak klucza API'}`);
    lines.push(`- Tryb: ${caps.tauriAvailable ? '🖥️ Aplikacja desktopowa' : '🌐 Przeglądarka'}`);
    if (caps.networkDetected) {
      lines.push(`- Sieć: ✅ Wykryto podsieć ${caps.networkDetected}.0/24`);
    }
    lines.push('\nSkonfiguruj poniżej lub wpisz **"pomoc"** aby zobaczyć dostępne komendy:');
  } else {
    lines.push('✅ **Broxeen gotowy do użycia**\n');
    lines.push('**Status:**');
    lines.push(`- AI: ✅ Model: ${configStore.get<string>('llm.model')}`);
    lines.push(`- Tryb: ${caps.tauriAvailable ? '🖥️ Aplikacja desktopowa' : '🌐 Przeglądarka'}`);
    if (caps.networkDetected) {
      lines.push(`- Sieć: ✅ ${caps.networkDetected}.0/24`);
    }
    lines.push('\nWpisz komendę lub kliknij przycisk poniżej:');
  }

  return lines.join('\n');
}
