/**
 * Marketplace Plugin Loader - loads remote plugins from marketplace URLs
 * Allows users to install third-party plugins into any scope.
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';
import type { ScopeId, RemotePluginManifest } from '../scope/scopeRegistry';
import { scopeRegistry } from '../scope/scopeRegistry';

// ─── Marketplace Catalog ─────────────────────────────────────

export interface MarketplaceEntry {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly scope: ScopeId;
  readonly tags: string[];
  readonly downloads: number;
  readonly rating: number;
  readonly moduleUrl: string;
  readonly marketplaceUrl: string;
  readonly iconUrl?: string;
  readonly updatedAt: string;
}

// ─── Built-in Marketplace Catalog (demo) ─────────────────────

const DEMO_CATALOG: MarketplaceEntry[] = [
  {
    id: 'community-upnp-scanner',
    name: 'UPnP Scanner',
    version: '1.2.0',
    description: 'Wykrywanie urządzeń UPnP/DLNA w sieci lokalnej',
    author: 'community',
    scope: 'local',
    tags: ['network', 'upnp', 'dlna', 'discovery'],
    downloads: 1250,
    rating: 4.5,
    moduleUrl: 'https://plugins.broxeen.dev/community-upnp-scanner/1.2.0/plugin.js',
    marketplaceUrl: 'https://marketplace.broxeen.dev/plugins/community-upnp-scanner',
    updatedAt: '2026-02-20',
  },
  {
    id: 'community-bandwidth-monitor',
    name: 'Bandwidth Monitor',
    version: '0.9.1',
    description: 'Monitor przepustowości sieci w czasie rzeczywistym',
    author: 'community',
    scope: 'local',
    tags: ['network', 'bandwidth', 'monitoring', 'speed'],
    downloads: 890,
    rating: 4.2,
    moduleUrl: 'https://plugins.broxeen.dev/community-bandwidth-monitor/0.9.1/plugin.js',
    marketplaceUrl: 'https://marketplace.broxeen.dev/plugins/community-bandwidth-monitor',
    updatedAt: '2026-02-18',
  },
  {
    id: 'community-dns-lookup',
    name: 'DNS Lookup',
    version: '1.0.3',
    description: 'Rozpoznawanie DNS, reverse DNS, WHOIS',
    author: 'community',
    scope: 'network',
    tags: ['network', 'dns', 'whois', 'lookup'],
    downloads: 2100,
    rating: 4.7,
    moduleUrl: 'https://plugins.broxeen.dev/community-dns-lookup/1.0.3/plugin.js',
    marketplaceUrl: 'https://marketplace.broxeen.dev/plugins/community-dns-lookup',
    updatedAt: '2026-02-15',
  },
  {
    id: 'community-ip-geolocation',
    name: 'IP Geolocation',
    version: '1.1.0',
    description: 'Geolokalizacja adresów IP na mapie',
    author: 'community',
    scope: 'internet',
    tags: ['network', 'geolocation', 'ip', 'map'],
    downloads: 3400,
    rating: 4.8,
    moduleUrl: 'https://plugins.broxeen.dev/community-ip-geolocation/1.1.0/plugin.js',
    marketplaceUrl: 'https://marketplace.broxeen.dev/plugins/community-ip-geolocation',
    updatedAt: '2026-02-19',
  },
  {
    id: 'community-camera-timelapse',
    name: 'Camera Timelapse',
    version: '0.5.0',
    description: 'Tworzenie timelapse z kamer IP',
    author: 'community',
    scope: 'local',
    tags: ['camera', 'timelapse', 'recording'],
    downloads: 560,
    rating: 4.0,
    moduleUrl: 'https://plugins.broxeen.dev/community-camera-timelapse/0.5.0/plugin.js',
    marketplaceUrl: 'https://marketplace.broxeen.dev/plugins/community-camera-timelapse',
    updatedAt: '2026-02-10',
  },
  {
    id: 'community-snmp-monitor',
    name: 'SNMP Monitor',
    version: '1.0.0',
    description: 'Monitoring urządzeń sieciowych przez SNMP',
    author: 'community',
    scope: 'local',
    tags: ['network', 'snmp', 'monitoring', 'router'],
    downloads: 780,
    rating: 4.3,
    moduleUrl: 'https://plugins.broxeen.dev/community-snmp-monitor/1.0.0/plugin.js',
    marketplaceUrl: 'https://marketplace.broxeen.dev/plugins/community-snmp-monitor',
    updatedAt: '2026-02-12',
  },
];

// ─── Marketplace Plugin (exposes catalog + install as a Plugin) ──

export class MarketplacePlugin implements Plugin {
  readonly id = 'marketplace';
  readonly name = 'Plugin Marketplace';
  readonly version = '1.0.0';
  readonly supportedIntents = ['marketplace:browse', 'marketplace:install', 'marketplace:uninstall', 'marketplace:search'];

  private catalog: MarketplaceEntry[] = [...DEMO_CATALOG];

  /** Data-driven route table: [route_key, patterns] */
  private static readonly ROUTE_TABLE: ReadonlyArray<[string, readonly RegExp[]]> = [
    ['install',   [/zainstaluj.*plugin/i, /install.*plugin/i]],
    ['uninstall', [/odinstaluj.*plugin/i, /uninstall.*plugin/i, /usun.*plugin/i, /usuń.*plugin/i]],
    ['search',    [/szukaj.*plugin/i, /wyszukaj.*plugin/i]],
    ['browse',    [/marketplace/i, /plugin.*store/i, /lista.*plugin/i, /dostępne.*plugin/i, /dostepne.*plugin/i]],
  ];

  private static resolveRoute(input: string): string | null {
    const lower = input.toLowerCase();
    for (const [key, patterns] of MarketplacePlugin.ROUTE_TABLE) {
      if (patterns.some(p => p.test(lower))) return key;
    }
    return null;
  }

  async canHandle(input: string, _context: PluginContext): Promise<boolean> {
    return MarketplacePlugin.resolveRoute(input) !== null;
  }

  async execute(input: string, _context: PluginContext): Promise<PluginResult> {
    const start = Date.now();
    const route = MarketplacePlugin.resolveRoute(input);

    switch (route) {
      case 'install':   return this.handleInstall(input, start);
      case 'uninstall': return this.handleUninstall(input, start);
      case 'search':    return this.handleSearch(input, start);
      default:          return this.handleBrowse(start);
    }
  }

  private handleBrowse(start: number): PluginResult {
    const installed = this.getInstalledPluginIds();

    let data = `🏪 **Broxeen Plugin Marketplace**\n\n`;
    data += `Dostępnych pluginów: ${this.catalog.length}\n\n`;

    for (const entry of this.catalog) {
      const isInstalled = installed.has(entry.id);
      const status = isInstalled ? '✅ Zainstalowany' : '⬇️ Dostępny';
      const stars = '⭐'.repeat(Math.round(entry.rating));

      data += `### ${entry.name} v${entry.version}\n`;
      data += `${entry.description}\n`;
      data += `- **Autor:** ${entry.author}\n`;
      data += `- **Scope:** ${entry.scope}\n`;
      data += `- **Ocena:** ${stars} (${entry.rating})\n`;
      data += `- **Pobrania:** ${entry.downloads}\n`;
      data += `- **Status:** ${status}\n`;
      data += `- **Tagi:** ${entry.tags.join(', ')}\n\n`;
    }

    data += `💡 *Aby zainstalować: "zainstaluj plugin [nazwa]"*\n`;
    data += `💡 *Aby wyszukać: "szukaj plugin [słowo kluczowe]"*`;

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data, title: 'Plugin Marketplace' }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  private handleSearch(input: string, start: number): PluginResult {
    const query = input.replace(/^.*(?:szukaj|wyszukaj|search)\s*(?:plugin[ów]?\s*)?/i, '').trim().toLowerCase();

    const results = this.catalog.filter(e =>
      e.name.toLowerCase().includes(query) ||
      e.description.toLowerCase().includes(query) ||
      e.tags.some(t => t.includes(query))
    );

    if (results.length === 0) {
      return {
        pluginId: this.id,
        status: 'success',
        content: [{
          type: 'text',
          data: `🔍 Nie znaleziono pluginów dla: "${query}"\n\nSpróbuj: "marketplace" aby zobaczyć wszystkie dostępne pluginy.`,
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    let data = `🔍 **Wyniki wyszukiwania: "${query}"** — ${results.length} wyników\n\n`;
    for (const e of results) {
      data += `- **${e.name}** v${e.version} — ${e.description} (⭐${e.rating})\n`;
    }
    data += `\n💡 *Aby zainstalować: "zainstaluj plugin [nazwa]"*`;

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data, title: `Wyniki: ${query}` }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  private handleInstall(input: string, start: number): PluginResult {
    const pluginName = input.replace(/^.*(?:zainstaluj|install)\s*(?:plugin\s*)?/i, '').trim().toLowerCase();

    const entry = this.catalog.find(e =>
      e.name.toLowerCase().includes(pluginName) || e.id.includes(pluginName)
    );

    if (!entry) {
      return {
        pluginId: this.id,
        status: 'error',
        content: [{
          type: 'text',
          data: `❌ Nie znaleziono pluginu: "${pluginName}"\n\nSprawdź dostępne pluginy: "marketplace"`,
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    const manifest: RemotePluginManifest = {
      id: entry.id,
      name: entry.name,
      version: entry.version,
      description: entry.description,
      author: entry.author,
      marketplaceUrl: entry.marketplaceUrl,
      moduleUrl: entry.moduleUrl,
      installedAt: Date.now(),
      scope: entry.scope,
    };

    try {
      scopeRegistry.installRemotePlugin(manifest);
      scopeRegistry.persist();
    } catch (error) {
      return {
        pluginId: this.id,
        status: 'error',
        content: [{
          type: 'text',
          data: `❌ Błąd instalacji: ${error instanceof Error ? error.message : String(error)}`,
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    return {
      pluginId: this.id,
      status: 'success',
      content: [{
        type: 'text',
        data: `✅ **Plugin zainstalowany!**\n\n` +
          `- **Nazwa:** ${entry.name}\n` +
          `- **Wersja:** ${entry.version}\n` +
          `- **Scope:** ${entry.scope}\n` +
          `- **Autor:** ${entry.author}\n\n` +
          `Plugin jest aktywny w scope: **${entry.scope}**.\n` +
          `💡 *Aby odinstalować: "odinstaluj plugin ${entry.name}"*`,
        title: `Zainstalowano: ${entry.name}`,
      }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  private handleUninstall(input: string, start: number): PluginResult {
    const pluginName = input.replace(/^.*(?:odinstaluj|uninstall|usun|usuń)\s*(?:plugin\s*)?/i, '').trim().toLowerCase();

    // Search installed plugins across all scopes
    for (const scope of scopeRegistry.getAllScopes()) {
      const found = scope.remotePlugins.find(p =>
        p.name.toLowerCase().includes(pluginName) || p.id.includes(pluginName)
      );

      if (found) {
        scopeRegistry.uninstallRemotePlugin(found.id, scope.id);
        scopeRegistry.persist();

        return {
          pluginId: this.id,
          status: 'success',
          content: [{
            type: 'text',
            data: `✅ **Plugin odinstalowany:** ${found.name}\n\nUsunięto ze scope: ${scope.id}`,
            title: `Odinstalowano: ${found.name}`,
          }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
        };
      }
    }

    return {
      pluginId: this.id,
      status: 'error',
      content: [{
        type: 'text',
        data: `❌ Nie znaleziono zainstalowanego pluginu: "${pluginName}"`,
      }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  private getInstalledPluginIds(): Set<string> {
    const ids = new Set<string>();
    for (const scope of scopeRegistry.getAllScopes()) {
      for (const p of scope.remotePlugins) {
        ids.add(p.id);
      }
    }
    return ids;
  }

  async initialize(context: PluginContext): Promise<void> {
    scopeRegistry.restore();
    console.log('MarketplacePlugin initialized');
  }

  async dispose(): Promise<void> {
    scopeRegistry.persist();
    console.log('MarketplacePlugin disposed');
  }
}
