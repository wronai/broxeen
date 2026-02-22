import type { Plugin, PluginContext, PluginResult } from '../../core/types';
import { createScopedLogger } from '../../lib/logger';

const logger = createScopedLogger('plugin:auth-browse');

/**
 * AuthBrowsePlugin - enables authenticated web browsing for cameras and devices
 * 
 * Usage examples:
 * - "przeglądaj http://192.168.188.146 --user admin --pass 123456"
 * - "browse http://192.168.188.146 --username admin --password 123456"
 * - "otwórz http://192.168.188.146 z uwierzytelnieniem admin:123456"
 */
export class AuthBrowsePlugin implements Plugin {
  readonly id = 'auth-browse';
  readonly name = 'Authenticated Browser';
  readonly version = '1.0.0';
  readonly supportedIntents = ['browse', 'przeglądaj', 'otwórz', 'open'];
  readonly description = 'Browse web pages with authentication (Basic Auth)';
  readonly author = 'Broxeen Team';
  readonly keywords = ['browse', 'web', 'auth', 'login', 'camera', 'http'];
  readonly examples = [
    'przeglądaj http://192.168.188.146 --user admin --pass 123456',
    'browse http://192.168.188.146 --username admin --password 123456',
    'otwórz http://192.168.188.146 z uwierzytelnieniem admin:123456'
  ];
  readonly category = 'network';
  readonly enabled = true;
  readonly streaming = false;
  readonly requiresNetwork = true;
  readonly browserCompatible = false; // Requires Tauri for invoke
  readonly priority = 85; // Higher than default browse

  async canHandle(input: string, context: PluginContext): Promise<boolean> {
    const lower = input.toLowerCase();
    
    // Check for browse-related keywords
    const browseKeywords = ['przeglądaj', 'browse', 'otwórz', 'open', 'pokaż', 'show'];
    const hasBrowseKeyword = browseKeywords.some(keyword => lower.includes(keyword));
    
    // Check for HTTP/HTTPS URL
    const urlMatch = input.match(/https?:\/\/[^\s]+/);
    const hasUrl = !!urlMatch;
    
    // Check for authentication indicators
    const authIndicators = [
      /--user\s+\w+/, /--username\s+\w+/, /--pass\s+\S+/, /--password\s+\S+/,
      /z uwierzytelnieniem\s+\w+:\S+/, /with authentication\s+\w+:\S+/,
      /admin:\S+/, /user:\S+/
    ];
    const hasAuth = authIndicators.some(pattern => pattern.test(input));
    
    return hasBrowseKeyword && hasUrl && hasAuth;
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    logger.info('Executing auth browse command', { input });

    // Extract URL
    const urlMatch = input.match(/https?:\/\/[^\s]+/);
    if (!urlMatch) {
      return {
        pluginId: this.id,
        status: 'error',
        content: [{
          type: 'text' as const,
          data: 'Nie znaleziono URL w komendzie'
        }],
        metadata: {
          duration_ms: 0,
          cached: false,
          truncated: false
        }
      };
    }
    const url = urlMatch[0];

    // Extract credentials
    let username: string | undefined;
    let password: string | undefined;

    // Try different patterns
    const userMatch = input.match(/--(?:user|username)\s+(\w+)/i);
    const passMatch = input.match(/--(?:pass|password)\s+(\S+)/i);
    const authMatch = input.match(/(?:z uwierzytelnieniem|with authentication)\s+(\w+):(\S+)/i);
    const directMatch = input.match(/(\w+):(\S+)@/);

    if (userMatch && passMatch) {
      username = userMatch[1];
      password = passMatch[1];
    } else if (authMatch) {
      username = authMatch[1];
      password = authMatch[2];
    } else if (directMatch) {
      username = directMatch[1];
      password = directMatch[2];
    }

    if (!username || !password) {
      return {
        pluginId: this.id,
        status: 'error',
        content: [{
          type: 'text' as const,
          data: 'Nie znaleziono danych uwierzytelniających. Użyj formatu: --user <username> --pass <password>'
        }],
        metadata: {
          duration_ms: 0,
          cached: false,
          truncated: false
        }
      };
    }

    logger.info('Extracted credentials', { username, url });

    try {
      if (context.isTauri && context.tauriInvoke) {
        // Use Tauri backend with authentication
        const authHeader = `Basic ${btoa(`${username}:${password}`)}`;
        
        logger.info('Making authenticated request via Tauri', { url, hasAuth: true });
        
        const result = await context.tauriInvoke('browse', {
          url,
          headers: { Authorization: authHeader }
        }) as {
          url?: string;
          title?: string;
          content?: string;
          screenshotBase64?: string;
          status?: string;
        };

        logger.info('Auth browse completed', {
          url,
          titleLength: result.title?.length || 0,
          contentLength: result.content?.length || 0,
          status: result.status || 'unknown'
        });

        return {
          pluginId: this.id,
          status: 'success',
          content: [{
            type: 'html' as const,
            data: result.content || 'Brak treści',
            title: result.title || 'Brak tytułu',
            mimeType: 'text/html'
          }],
          metadata: {
            duration_ms: 0,
            source_url: result.url || url,
            cached: false,
            truncated: false
          }
        };
      } else {
        return {
          pluginId: this.id,
          status: 'error',
          content: [{
            type: 'text' as const,
            data: 'Przeglądanie z uwierzytelnianiem wymaga środowiska Tauri'
          }],
          metadata: {
            duration_ms: 0,
            cached: false,
            truncated: false
          }
        };
      }
    } catch (error) {
      logger.error('Auth browse failed', { error: error instanceof Error ? error.message : String(error) });
      
      return {
        pluginId: this.id,
        status: 'error',
        content: [{
          type: 'text' as const,
          data: `Błąd przeglądania: ${error instanceof Error ? error.message : String(error)}`
        }],
        metadata: {
          duration_ms: 0,
          cached: false,
          truncated: false
        }
      };
    }
  }
}
