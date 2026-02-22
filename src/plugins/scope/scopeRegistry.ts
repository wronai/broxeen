/**
 * @module plugins/scope/scopeRegistry
 * @description Scope-based plugin registry.
 *
 * Scopes define which plugins are active for a given context:
 * - "local"    — LAN-only: network scan, cameras, IoT, no internet
 * - "network"  — LAN + internet: all local + browse + search
 * - "internet" — internet-only: browse, search, LLM
 * - "remote"   — remote plugins loaded from marketplace
 *
 * Users can load remote plugins from marketplace into any scope.
 */

// ─── Scope Definition ───────────────────────────────────────

export type ScopeId = 'local' | 'network' | 'internet' | 'remote' | string;

export interface ScopeDefinition {
  readonly id: ScopeId;
  readonly name: string;
  readonly description: string;
  /** Plugin IDs allowed in this scope */
  readonly allowedPlugins: readonly string[];
  /** Whether internet access is permitted */
  readonly allowInternet: boolean;
  /** Whether LAN access is permitted */
  readonly allowLan: boolean;
  /** User-installed remote plugins */
  readonly remotePlugins: RemotePluginManifest[];
}

export interface RemotePluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly marketplaceUrl: string;
  /** Loaded plugin module URL or inline code */
  readonly moduleUrl: string;
  readonly installedAt: number;
  readonly scope: ScopeId;
}

// ─── Built-in Scope Definitions ─────────────────────────────

export const BUILTIN_SCOPES: Record<ScopeId, Omit<ScopeDefinition, 'remotePlugins'>> = {
  local: {
    id: 'local',
    name: 'Sieć lokalna',
    description: 'Tylko urządzenia w sieci LAN — kamery, IoT, skanowanie',
    allowedPlugins: [
      'network-scan', 'network-ping', 'network-arp', 'network-mdns',
      'network-port-scan', 'network-onvif', 'network-wol',
      'rtsp-camera', 'camera-health', 'camera-ptz', 'camera-snapshot',
      'mqtt', 'service-probe', 'monitor', 'protocol-bridge',
    ],
    allowInternet: false,
    allowLan: true,
  },
  network: {
    id: 'network',
    name: 'Sieć + Internet',
    description: 'Pełny dostęp — LAN i internet',
    allowedPlugins: [
      'network-scan', 'network-ping', 'network-arp', 'network-mdns',
      'network-port-scan', 'network-onvif', 'network-wol',
      'rtsp-camera', 'camera-health', 'camera-ptz', 'camera-snapshot',
      'mqtt', 'service-probe', 'monitor', 'protocol-bridge',
      'http-browse', 'chat-llm', 'marketplace',
    ],
    allowInternet: true,
    allowLan: true,
  },
  internet: {
    id: 'internet',
    name: 'Internet',
    description: 'Tylko internet — przeglądanie, wyszukiwanie, LLM',
    allowedPlugins: ['http-browse', 'chat-llm', 'marketplace', 'protocol-bridge'],
    allowInternet: true,
    allowLan: false,
  },
  vpn: {
    id: 'vpn',
    name: 'VPN',
    description: 'Połączenie przez VPN — dostęp do zdalnych sieci prywatnych',
    allowedPlugins: [
      'network-scan', 'network-ping', 'network-arp', 'network-mdns',
      'network-port-scan', 'network-onvif', 'network-wol',
      'rtsp-camera', 'camera-health', 'camera-ptz', 'camera-snapshot',
      'mqtt', 'service-probe', 'monitor', 'protocol-bridge',
      'http-browse', 'chat-llm', 'marketplace',
    ],
    allowInternet: true,
    allowLan: true,
  },
  tor: {
    id: 'tor',
    name: 'Sieć Tor',
    description: 'Anonimowe połączenie przez sieć Tor — .onion',
    allowedPlugins: [
      'http-browse', 'chat-llm', 'marketplace', 'monitor',
    ],
    allowInternet: true,
    allowLan: false,
  },
  remote: {
    id: 'remote',
    name: 'Marketplace',
    description: 'Pluginy załadowane z marketplace',
    allowedPlugins: ['marketplace'],
    allowInternet: true,
    allowLan: true,
  },
};

// ─── Scope Registry ─────────────────────────────────────────

export class ScopeRegistry {
  private scopes = new Map<ScopeId, ScopeDefinition>();
  private activeScope: ScopeId = 'network';

  private normalizeScopeId(scopeId?: ScopeId): ScopeId {
    return scopeId ?? this.activeScope;
  }

  constructor() {
    for (const [id, def] of Object.entries(BUILTIN_SCOPES)) {
      this.scopes.set(id, { ...def, remotePlugins: [] });
    }
  }

  getScope(id: ScopeId): ScopeDefinition | undefined {
    return this.scopes.get(this.normalizeScopeId(id));
  }

  getAllScopes(): ScopeDefinition[] {
    return Array.from(this.scopes.values());
  }

  getActiveScope(): ScopeDefinition {
    return this.scopes.get(this.normalizeScopeId(this.activeScope)) ?? this.scopes.get('network')!;
  }

  setActiveScope(id: ScopeId): void {
    const normalized = this.normalizeScopeId(id);
    if (!this.scopes.has(normalized)) {
      throw new Error(`Unknown scope: ${id}`);
    }
    this.activeScope = normalized;
    console.log(`[ScopeRegistry] Active scope changed to: ${normalized}`);
  }

  isPluginAllowed(pluginId: string, scopeId?: ScopeId): boolean {
    const scope = this.scopes.get(this.normalizeScopeId(scopeId));
    if (!scope) return false;
    return scope.allowedPlugins.includes(pluginId) ||
      scope.remotePlugins.some(p => p.id === pluginId);
  }

  /** Install a remote plugin from marketplace into a scope */
  installRemotePlugin(manifest: RemotePluginManifest): void {
    const scope = this.scopes.get(manifest.scope);
    if (!scope) throw new Error(`Unknown scope: ${manifest.scope}`);

    const existing = scope.remotePlugins.findIndex(p => p.id === manifest.id);
    const updated = existing >= 0
      ? scope.remotePlugins.map((p, i) => i === existing ? manifest : p)
      : [...scope.remotePlugins, manifest];

    this.scopes.set(manifest.scope, { ...scope, remotePlugins: updated });
    console.log(`[ScopeRegistry] Installed remote plugin: ${manifest.id} into scope: ${manifest.scope}`);
  }

  /** Remove a remote plugin from a scope */
  uninstallRemotePlugin(pluginId: string, scopeId: ScopeId): void {
    const scope = this.scopes.get(scopeId);
    if (!scope) throw new Error(`Unknown scope: ${scopeId}`);

    this.scopes.set(scopeId, {
      ...scope,
      remotePlugins: scope.remotePlugins.filter(p => p.id !== pluginId),
    });
    console.log(`[ScopeRegistry] Uninstalled remote plugin: ${pluginId} from scope: ${scopeId}`);
  }

  /** List remote plugins available in a scope */
  getRemotePlugins(scopeId?: ScopeId): RemotePluginManifest[] {
    const scope = this.scopes.get(this.normalizeScopeId(scopeId));
    return scope?.remotePlugins ?? [];
  }

  /** Persist scope config to localStorage */
  persist(): void {
    try {
      const data: Record<string, RemotePluginManifest[]> = {};
      for (const [id, scope] of this.scopes) {
        data[id] = scope.remotePlugins;
      }
      localStorage.setItem('broxeen:scope-registry', JSON.stringify({
        activeScope: this.activeScope,
        remotePlugins: data,
      }));
    } catch { /* ignore */ }
  }

  /** Restore scope config from localStorage */
  restore(): void {
    try {
      const raw = localStorage.getItem('broxeen:scope-registry');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.activeScope) this.activeScope = data.activeScope;
      if (data.remotePlugins) {
        for (const [scopeId, plugins] of Object.entries(data.remotePlugins)) {
          const scope = this.scopes.get(scopeId);
          if (scope) {
            this.scopes.set(scopeId, { ...scope, remotePlugins: plugins as RemotePluginManifest[] });
          }
        }
      }
    } catch { /* ignore */ }
  }
}

export const scopeRegistry = new ScopeRegistry();
