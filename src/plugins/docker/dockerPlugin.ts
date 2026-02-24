import { Plugin, PluginContext, PluginResult } from '../../core/types';

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string[];
  created: string;
}

export interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

export interface DockerVolume {
  name: string;
  driver: string;
  mountpoint: string;
  size: string;
}

export interface DockerNetwork {
  id: string;
  name: string;
  driver: string;
  scope: string;
}

export interface DockerInfo {
  version: string;
  containers_running: number;
  containers_total: number;
  images_total: number;
  server_version: string;
}

export class DockerPlugin implements Plugin {
  readonly id = 'docker';
  readonly name = 'Docker';
  readonly description = 'Zarządzanie kontenerami Docker na lokalnej maszynie';
  readonly version = '1.0.0';
  readonly supportedIntents = ['docker', 'kontener', 'kontenery', 'obraz', 'docker-info'];

  private context!: PluginContext;

  async initialize(context: PluginContext): Promise<void> {
    this.context = context;
    console.log('[DockerPlugin] Initialized');
  }

  async dispose(): Promise<void> {
    console.log('[DockerPlugin] Disposed');
  }

  async canHandle(input: string, context: PluginContext): Promise<boolean> {
    const dockerKeywords = [
      'docker', 'kontener', 'kontenery', 'kontenera', 'kontenerów',
      'obraz', 'obrazy', 'dockerowy', 'dockerem',
      'uruchom kontener', 'zatrzymaj kontener', 'restart kontener',
      'docker logs', 'docker ps', 'docker images'
    ];
    return dockerKeywords.some(keyword => 
      input.toLowerCase().includes(keyword.toLowerCase())
    );
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const intentLower = input.toLowerCase();

    try {
      // Check if Docker is available
      const isAvailable = await this.context.tauriInvoke?.('docker_is_available');
      if (!isAvailable) {
        return {
          pluginId: this.id,
          status: 'error',
          content: [{
            type: 'text',
            data: 'Docker nie jest dostępny na tej maszynie. Upewnij się, że Docker jest zainstalowany i uruchomiony.'
          }],
          metadata: {
            duration_ms: 0,
            cached: false,
            truncated: false
          }
        };
      }

      // Handle different Docker commands
      if (intentLower.includes('info') || intentLower.includes('status')) {
        const info = await this.context.tauriInvoke?.('docker_info') as DockerInfo;
        return {
          pluginId: this.id,
          status: 'success',
          content: [{
            type: 'text',
            data: `Docker ${info.version}\nKontenery uruchomione: ${info.containers_running}/${info.containers_total}\nObrazy: ${info.images_total}`
          }],
          metadata: {
            duration_ms: 0,
            cached: false,
            truncated: false
          }
        };
      }

      if (intentLower.includes('kontener') || intentLower.includes('ps') || intentLower.includes('list')) {
        const all = intentLower.includes('wszystkie') || intentLower.includes('all') || intentLower.includes('-a');
        const containers = await this.context.tauriInvoke?.('docker_list_containers', { all }) as DockerContainer[];
        
        if (containers.length === 0) {
          return {
            pluginId: this.id,
            status: 'success',
            content: [{
              type: 'text',
              data: all ? 'Brak kontenerów' : 'Brak uruchomionych kontenerów'
            }],
            metadata: {
              duration_ms: 0,
              cached: false,
              truncated: false
            }
          };
        }

        const containerList = containers.map(c => 
          `${c.name} (${c.id.substring(0, 12)}) - ${c.status} - ${c.image}`
        ).join('\n');

        return {
          pluginId: this.id,
          status: 'success',
          content: [{
            type: 'text',
            data: `Kontenery (${containers.length}):\n${containerList}`
          }],
          metadata: {
            duration_ms: 0,
            cached: false,
            truncated: false
          }
        };
      }

      if (intentLower.includes('obraz') || intentLower.includes('images')) {
        const images = await this.context.tauriInvoke?.('docker_list_images') as DockerImage[];
        
        if (images.length === 0) {
          return {
            pluginId: this.id,
            status: 'success',
            content: [{
              type: 'text',
              data: 'Brak obrazów Docker'
            }],
            metadata: {
              duration_ms: 0,
              cached: false,
              truncated: false
            }
          };
        }

        const imageList = images.map(i => 
          `${i.repository}:${i.tag} (${i.id.substring(0, 12)}) - ${i.size}`
        ).join('\n');

        return {
          pluginId: this.id,
          status: 'success',
          content: [{
            type: 'text',
            data: `Obrazy Docker (${images.length}):\n${imageList}`
          }],
          metadata: {
            duration_ms: 0,
            cached: false,
            truncated: false
          }
        };
      }

      if (intentLower.includes('wolumin') || intentLower.includes('volume')) {
        const volumes = await this.context.tauriInvoke?.('docker_list_volumes') as DockerVolume[];
        
        if (volumes.length === 0) {
          return {
            pluginId: this.id,
            status: 'success',
            content: [{
              type: 'text',
              data: 'Brak woluminów Docker'
            }],
            metadata: {
              duration_ms: 0,
              cached: false,
              truncated: false
            }
          };
        }

        const volumeList = volumes.map(v => 
          `${v.name} - ${v.driver} - ${v.size}`
        ).join('\n');

        return {
          pluginId: this.id,
          status: 'success',
          content: [{
            type: 'text',
            data: `Woluminy Docker (${volumes.length}):\n${volumeList}`
          }],
          metadata: {
            duration_ms: 0,
            cached: false,
            truncated: false
          }
        };
      }

      if (intentLower.includes('sieć') || intentLower.includes('network')) {
        const networks = await this.context.tauriInvoke?.('docker_list_networks') as DockerNetwork[];
        
        if (networks.length === 0) {
          return {
            pluginId: this.id,
            status: 'success',
            content: [{
              type: 'text',
              data: 'Brak sieci Docker'
            }],
            metadata: {
              duration_ms: 0,
              cached: false,
              truncated: false
            }
          };
        }

        const networkList = networks.map(n => 
          `${n.name} (${n.id.substring(0, 12)}) - ${n.driver} - ${n.scope}`
        ).join('\n');

        return {
          pluginId: this.id,
          status: 'success',
          content: [{
            type: 'text',
            data: `Sieci Docker (${networks.length}):\n${networkList}`
          }],
          metadata: {
            duration_ms: 0,
            cached: false,
            truncated: false
          }
        };
      }

      // Container operations
      if (intentLower.includes('uruchom') || intentLower.includes('start')) {
        const containerId = this.extractContainerId(input);
        if (!containerId) {
          return {
            pluginId: this.id,
            status: 'error',
            content: [{
              type: 'text',
              data: 'Nie można zidentyfikować kontenera. Podaj ID lub nazwę kontenera.'
            }],
            metadata: {
              duration_ms: 0,
              cached: false,
              truncated: false
            }
          };
        }

        const result = await this.context.tauriInvoke?.('docker_start_container', { containerId });
        return {
          pluginId: this.id,
          status: 'success',
          content: [{
            type: 'text',
            data: result
          }],
          metadata: {
            duration_ms: 0,
            cached: false,
            truncated: false
          }
        };
      }

      if (intentLower.includes('zatrzymaj') || intentLower.includes('stop')) {
        const containerId = this.extractContainerId(input);
        if (!containerId) {
          return {
            pluginId: this.id,
            status: 'error',
            content: [{
              type: 'text',
              data: 'Nie można zidentyfikować kontenera. Podaj ID lub nazwę kontenera.'
            }],
            metadata: {
              duration_ms: 0,
              cached: false,
              truncated: false
            }
          };
        }

        const result = await this.context.tauriInvoke?.('docker_stop_container', { containerId });
        return {
          pluginId: this.id,
          status: 'success',
          content: [{
            type: 'text',
            data: result
          }],
          metadata: {
            duration_ms: 0,
            cached: false,
            truncated: false
          }
        };
      }

      if (intentLower.includes('restart')) {
        const containerId = this.extractContainerId(input);
        if (!containerId) {
          return {
            pluginId: this.id,
            status: 'error',
            content: [{
              type: 'text',
              data: 'Nie można zidentyfikować kontenera. Podaj ID lub nazwę kontenera.'
            }],
            metadata: {
              duration_ms: 0,
              cached: false,
              truncated: false
            }
          };
        }

        const result = await this.context.tauriInvoke?.('docker_restart_container', { containerId });
        return {
          pluginId: this.id,
          status: 'success',
          content: [{
            type: 'text',
            data: result
          }],
          metadata: {
            duration_ms: 0,
            cached: false,
            truncated: false
          }
        };
      }

      if (intentLower.includes('usuń') || intentLower.includes('remove') || intentLower.includes('rm')) {
        const containerId = this.extractContainerId(input);
        if (!containerId) {
          return {
            pluginId: this.id,
            status: 'error',
            content: [{
              type: 'text',
              data: 'Nie można zidentyfikować kontenera. Podaj ID lub nazwę kontenera.'
            }],
            metadata: {
              duration_ms: 0,
              cached: false,
              truncated: false
            }
          };
        }

        const force = intentLower.includes('force') || intentLower.includes('-f');
        const result = await this.context.tauriInvoke?.('docker_remove_container', { containerId, force });
        return {
          pluginId: this.id,
          status: 'success',
          content: [{
            type: 'text',
            data: result
          }],
          metadata: {
            duration_ms: 0,
            cached: false,
            truncated: false
          }
        };
      }

      if (intentLower.includes('log') || intentLower.includes('logs')) {
        const containerId = this.extractContainerId(input);
        if (!containerId) {
          return {
            pluginId: this.id,
            status: 'error',
            content: [{
              type: 'text',
              data: 'Nie można zidentyfikować kontenera. Podaj ID lub nazwę kontenera.'
            }],
            metadata: {
              duration_ms: 0,
              cached: false,
              truncated: false
            }
          };
        }

        // Extract number of lines if specified
        const linesMatch = input.match(/(\d+)\s*(linii|lines|logów)/);
        const lines = linesMatch ? parseInt(linesMatch[1]) : undefined;

        const logs = await this.context.tauriInvoke?.('docker_get_logs', { containerId, lines });
        return {
          pluginId: this.id,
          status: 'success',
          content: [{
            type: 'text',
            data: `Logi kontenera ${containerId}:\n${logs}`
          }],
          metadata: {
            duration_ms: 0,
            cached: false,
            truncated: false
          }
        };
      }

      return {
        pluginId: this.id,
        status: 'error',
        content: [{
          type: 'text',
          data: 'Nie rozpoznano komendy Docker. Spróbuj: "docker status", "docker kontenery", "docker obrazy", "uruchom kontener <nazwa>", "zatrzymaj kontener <nazwa>"'
        }],
        metadata: {
          duration_ms: 0,
          cached: false,
          truncated: false
        }
      };

    } catch (error) {
      return {
        pluginId: this.id,
        status: 'error',
        content: [{
          type: 'text',
          data: `Błąd Docker: ${error instanceof Error ? error.message : String(error)}`
        }],
        metadata: {
          duration_ms: 0,
          cached: false,
          truncated: false
        }
      };
    }
  }

  private extractContainerId(intent: string): string | null {
    // Try to extract container name or ID from the intent
    const patterns = [
      /kontener(?:u)?\s+([a-zA-Z0-9_-]+)/i,
      /(?:uruchom|zatrzymaj|restart|usuń|rm|logs?)\s+([a-zA-Z0-9_-]+)/i,
      /([a-zA-Z0-9_-]+)\s+(?:kontener|uruchom|zatrzymaj|restart|usuń|rm|logs?)/i
    ];

    for (const pattern of patterns) {
      const match = intent.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return null;
  }
}
