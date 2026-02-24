import { Plugin, PluginContext, PluginResult } from '../../core/types';

export interface RemoteMachine {
  host: string;
  port: number;
  username: string;
  auth_type: 'Password' | 'Key';
  password?: string;
  private_key_path?: string;
  passphrase?: string;
  name?: string;
  description?: string;
}

export interface RemoteCommandResult {
  exit_code: number;
  stdout: string;
  stderr: string;
  success: boolean;
}

export interface RemoteSystemInfo {
  hostname: string;
  os: string;
  kernel: string;
  uptime: string;
  cpu_count: number;
  memory_total: string;
  disk_usage: DiskUsage[];
  network_interfaces: NetworkInterface[];
}

export interface DiskUsage {
  filesystem: string;
  size: string;
  used: string;
  available: string;
  usage_percent: number;
  mountpoint: string;
}

export interface NetworkInterface {
  name: string;
  ip_addresses: string[];
  mac_address?: string;
  is_up: boolean;
}

export interface RemoteProcess {
  pid: number;
  name: string;
  cpu_percent: number;
  memory_percent: number;
  status: string;
  user: string;
  command: string;
}

export class RemoteMachinePlugin implements Plugin {
  readonly id = 'remote-machine';
  readonly name = 'Zewnętrzna maszyna';
  readonly description = 'Zarządzanie zdalną maszyną przez SSH';
  readonly version = '1.0.0';
  readonly supportedIntents = ['remote', 'zdalna', 'maszyna', 'ssh', 'connect'];

  private context!: PluginContext;
  private savedMachines: RemoteMachine[] = [];

  async initialize(context: PluginContext): Promise<void> {
    this.context = context;
    this.loadSavedMachines();
    console.log('[RemoteMachinePlugin] Initialized');
  }

  async dispose(): Promise<void> {
    console.log('[RemoteMachinePlugin] Disposed');
  }

  async canHandle(input: string, context: PluginContext): Promise<boolean> {
    const remoteKeywords = [
      'zdalna', 'zewnętrzna', 'maszyna', 'serwer', 'host',
      'ssh', 'połączyć', 'connect', 'remote',
      'zdalny', 'połączenie', 'logowanie'
    ];
    return remoteKeywords.some(keyword => 
      input.toLowerCase().includes(keyword.toLowerCase())
    );
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const intentLower = input.toLowerCase();

    try {
      // Handle machine management
      if (intentLower.includes('dodaj') || intentLower.includes('zapisz') || intentLower.includes('add')) {
        return this.handleAddMachine(input);
      }

      if (intentLower.includes('lista') || intentLower.includes('pokaż') || intentLower.includes('list')) {
        return this.handleListMachines();
      }

      if (intentLower.includes('test') || intentLower.includes('sprawdź')) {
        return this.handleTestConnection(input);
      }

      if (intentLower.includes('połącz') || intentLower.includes('connect')) {
        return this.handleConnect(input);
      }

      // Extract machine info from intent
      const machine = this.extractMachineFromIntent(input);
      if (!machine) {
        return {
          pluginId: this.id,
          status: 'error',
          content: [{
            type: 'text',
            data: 'Nie można zidentyfikować maszyny. Użyj komendy "dodaj maszynę <host> <użytkownik>" lub podaj nazwę zapisanej maszyny.'
          }],
          metadata: {
            duration_ms: 0,
            cached: false,
            truncated: false
          }
        };
      }

      // Handle remote operations
      if (intentLower.includes('info') || intentLower.includes('status') || intentLower.includes('system')) {
        return this.handleSystemInfo(machine);
      }

      if (intentLower.includes('proces') || intentLower.includes('process')) {
        return this.handleListProcesses(machine);
      }

      if (intentLower.includes('docker')) {
        return this.handleCheckDocker(machine);
      }

      if (intentLower.includes('wykonaj') || intentLower.includes('execute') || intentLower.includes('run')) {
        return this.handleExecuteCommand(machine, input);
      }

      if (intentLower.includes('kopiuj') || intentLower.includes('copy') || intentLower.includes('scp')) {
        return this.handleCopyFile(machine, input);
      }

      return {
        pluginId: this.id,
        status: 'error',
        content: [{
          type: 'text',
          data: 'Nie rozpoznano komendy. Spróbuj: "dodaj maszynę", "lista maszyn", "połącz z <maszyna>", "info <maszyna>", "procesy <maszyna>"'
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
          data: `Błąd zdalnej maszyny: ${error instanceof Error ? error.message : String(error)}`
        }],
        metadata: {
          duration_ms: 0,
          cached: false,
          truncated: false
        }
      };
    }
  }

  private handleAddMachine(intent: string): PluginResult {
    // Simple extraction - in real implementation, this would be more sophisticated
    const hostMatch = intent.match(/(?:host|maszyna|serwer)\s+([a-zA-Z0-9.-]+)/i);
    const userMatch = intent.match(/(?:użytkownik|user|login)\s+([a-zA-Z0-9_-]+)/i);
    
    if (!hostMatch || !userMatch) {
      return {
        pluginId: this.id,
        status: 'error',
        content: [{
          type: 'text',
          data: 'Podaj host i użytkownika. Np: "dodaj maszynę 192.168.1.100 użytkownik admin"'
        }],
        metadata: {
          duration_ms: 0,
          cached: false,
          truncated: false
        }
      };
    }

    const machine: RemoteMachine = {
      host: hostMatch[1],
      port: 22,
      username: userMatch[1],
      auth_type: 'Key', // Default to key-based auth
      name: `${userMatch[1]}@${hostMatch[1]}`
    };

    this.savedMachines.push(machine);
    this.saveMachines();

    return {
      pluginId: this.id,
      status: 'success',
      content: [{
        type: 'text',
        data: `Dodano maszynę: ${machine.name}`
      }],
      metadata: {
        duration_ms: 0,
        cached: false,
        truncated: false
      }
    };
  }

  private handleListMachines(): PluginResult {
    if (this.savedMachines.length === 0) {
      return {
        pluginId: this.id,
        status: 'success',
        content: [{
          type: 'text',
          data: 'Brak zapisanych maszyn'
        }],
        metadata: {
        duration_ms: 0,
        cached: false,
        truncated: false
      }
      };
    }

    const machineList = this.savedMachines.map(m => 
      `${m.name || `${m.username}@${m.host}`} (${m.host}:${m.port}) - ${m.auth_type}`
    ).join('\n');

    return {
      pluginId: this.id,
      status: 'success',
      content: [{
        type: 'text',
        data: `Zapisane maszyny (${this.savedMachines.length}):\n${machineList}`
      }],
      metadata: {
        duration_ms: 0,
        cached: false,
        truncated: false
      }
    };
  }

  private handleTestConnection(intent: string): PluginResult {
    const machine = this.extractMachineFromIntent(intent);
    if (!machine) {
      return {
        pluginId: this.id,
        status: 'error',
        content: [{
          type: 'text',
          data: 'Nie można zidentyfikować maszyny do testu'
        }],
        metadata: {
          duration_ms: 0,
          cached: false,
          truncated: false
        }
      };
    }

    // This would be async in real implementation
    return {
      pluginId: this.id,
      status: 'success',
      content: [{
        type: 'text',
        data: `Testowanie połączenia z ${machine.host}... (implementacja w toku)`
      }],
      metadata: {
        duration_ms: 0,
        cached: false,
        truncated: false
      }
    };
  }

  private handleConnect(intent: string): PluginResult {
    const machine = this.extractMachineFromIntent(intent);
    if (!machine) {
      return {
        pluginId: this.id,
        status: 'error',
        content: [{
          type: 'text',
          data: 'Nie można zidentyfikować maszyny do połączenia'
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
      status: 'success',
      content: [{
        type: 'text',
        data: `Łączenie z ${machine.host}... (implementacja w toku)`
      }],
      metadata: {
        duration_ms: 0,
        cached: false,
        truncated: false
      }
    };
  }

  private async handleSystemInfo(machine: RemoteMachine): Promise<PluginResult> {
    const systemInfo = await this.context.tauriInvoke?.('remote_get_system_info', { machine }) as RemoteSystemInfo;
    
    const info = [
      `Host: ${systemInfo.hostname}`,
      `System: ${systemInfo.os}`,
      `Kernel: ${systemInfo.kernel}`,
      `Uptime: ${systemInfo.uptime}`,
      `CPU: ${systemInfo.cpu_count} rdzeni`,
      `Pamięć: ${systemInfo.memory_total}`,
      '',
      'Dyski:',
      ...systemInfo.disk_usage.map(d => `  ${d.filesystem} ${d.used}/${d.size} (${d.usage_percent}%)`),
      '',
      'Interfejsy sieciowe:',
      ...systemInfo.network_interfaces.map(n => `  ${n.name}: ${n.ip_addresses.join(', ')} ${n.is_up ? '(UP)' : '(DOWN)'}`)
    ].join('\n');

    return {
      pluginId: this.id,
      status: 'success',
      content: [{
        type: 'text',
        data: info
      }],
      metadata: {
        duration_ms: 0,
        cached: false,
        truncated: false
      }
    };
  }

  private async handleListProcesses(machine: RemoteMachine): Promise<PluginResult> {
    const processes = await this.context.tauriInvoke?.('remote_list_processes', { machine }) as RemoteProcess[];
    
    const processList = processes.slice(0, 20).map(p => 
      `${p.pid} ${p.user} ${p.cpu_percent}% ${p.memory_percent}% ${p.name}`
    ).join('\n');

    return {
      pluginId: this.id,
      status: 'success',
      content: [{
        type: 'text',
        data: `Procesy (${processes.length}):\n${processList}`
      }],
      metadata: {
        duration_ms: 0,
        cached: false,
        truncated: false
      }
    };
  }

  private async handleCheckDocker(machine: RemoteMachine): Promise<PluginResult> {
    const hasDocker = await this.context.tauriInvoke?.('remote_check_docker', { machine });
    
    return {
      pluginId: this.id,
      status: 'success',
      content: [{
        type: 'text',
        data: hasDocker ? 'Docker jest dostępny na zdalnej maszynie' : 'Docker nie jest dostępny na zdalnej maszynie'
      }],
      metadata: {
        duration_ms: 0,
        cached: false,
        truncated: false
      }
    };
  }

  private async handleExecuteCommand(machine: RemoteMachine, intent: string): Promise<PluginResult> {
    // Extract command from intent
    const commandMatch = intent.match(/(?:wykonaj|execute|run)\s+(.+)$/i);
    if (!commandMatch) {
      return {
        pluginId: this.id,
        status: 'error',
        content: [{
          type: 'text',
          data: 'Nie można zidentyfikować komendy do wykonania'
        }],
        metadata: {
          duration_ms: 0,
          cached: false,
          truncated: false
        }
      };
    }

    const command = commandMatch[1];
    const result = await this.context.tauriInvoke?.('remote_execute_command', { machine, command }) as RemoteCommandResult;
    
    let message = `Wykonano: ${command}\n`;
    message += `Kod wyjścia: ${result.exit_code}\n`;
    if (result.stdout) {
      message += `Wyjście:\n${result.stdout}\n`;
    }
    if (result.stderr) {
      message += `Błędy:\n${result.stderr}\n`;
    }

    return {
      pluginId: this.id,
      status: result.success ? 'success' : 'error',
      content: [{
        type: 'text',
        data: message
      }],
      metadata: {
        duration_ms: 0,
        cached: false,
        truncated: false
      }
    };
  }

  private async handleCopyFile(machine: RemoteMachine, intent: string): Promise<PluginResult> {
    // This would need more sophisticated parsing for file paths
    return {
      pluginId: this.id,
      status: 'success',
      content: [{
        type: 'text',
        data: 'Kopiowanie plików (implementacja w toku)'
      }],
      metadata: {
        duration_ms: 0,
        cached: false,
        truncated: false
      }
    };
  }

  private extractMachineFromIntent(intent: string): RemoteMachine | null {
    // Try to find machine by name in saved machines
    for (const machine of this.savedMachines) {
      if (intent.includes(machine.host) || 
          intent.includes(machine.username) ||
          (machine.name && intent.includes(machine.name))) {
        return machine;
      }
    }

    // Try to extract from intent pattern
    const hostMatch = intent.match(/([a-zA-Z0-9.-]+)/);
    const userMatch = intent.match(/([a-zA-Z0-9_-]+)@/);
    
    if (hostMatch) {
      return {
        host: hostMatch[1],
        port: 22,
        username: userMatch ? userMatch[1] : 'root',
        auth_type: 'Key'
      };
    }

    return null;
  }

  private loadSavedMachines(): void {
    try {
      const saved = localStorage.getItem('broxeen:remote-machines');
      if (saved) {
        this.savedMachines = JSON.parse(saved);
      }
    } catch (error) {
      console.error('Failed to load saved machines:', error);
    }
  }

  private saveMachines(): void {
    try {
      localStorage.setItem('broxeen:remote-machines', JSON.stringify(this.savedMachines));
    } catch (error) {
      console.error('Failed to save machines:', error);
    }
  }
}
