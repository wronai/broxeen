/**
 * @module plugins/system/diskInfoPlugin
 * @description Disk information plugin — queries local disk usage, partitions.
 * Also supports querying remote disk info via SSH in network context.
 *
 * Intents: "disk:info", "disk:usage", "disk:partitions"
 * Scope: local, network
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';

export class DiskInfoPlugin implements Plugin {
  readonly id = 'disk-info';
  readonly name = 'Disk Info';
  readonly version = '1.0.0';
  readonly supportedIntents = ['disk:info', 'disk:usage', 'disk:partitions'];

  async canHandle(input: string, _context: PluginContext): Promise<boolean> {
    const lower = input.toLowerCase();
    return (
      lower.includes('dysk') ||
      lower.includes('disk') ||
      lower.includes('partycj') ||
      lower.includes('partition') ||
      lower.includes('miejsce') ||
      lower.includes('wolne') ||
      lower.includes('storage') ||
      lower.includes('ile zajęte') ||
      lower.includes('ile wolnego') ||
      lower.includes('df ')
    );
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();
    const lower = input.toLowerCase();

    // Check if asking about remote host disk
    const remoteHost = this.extractRemoteHost(input);

    try {
      if (remoteHost) {
        return await this.executeRemote(remoteHost, input, context, start);
      }

      if (context.isTauri && context.tauriInvoke) {
        return await this.executeTauri(input, context, start);
      }

      return this.browserFallback(start);
    } catch (err) {
      return this.errorResult(
        `Błąd odczytu dysku: ${err instanceof Error ? err.message : String(err)}`,
        start,
      );
    }
  }

  private buildConfigPrompt(info: DiskInfo): string {
    const actions: string[] = [];
    
    // Add actions for high usage partitions
    const highUsage = info.partitions.filter((p) => p.use_percent > 85);
    if (highUsage.length > 0) {
      for (const p of highUsage) {
        actions.push(`Wyczyść ${p.mount_point}`);
        actions.push(`Pokaż duże pliki w ${p.mount_point}`);
      }
    }
    
    // General actions
    actions.push('Pokaż pliki w /');
    actions.push('Sprawdź logi systemowe');
    actions.push('Analiza zajętości dysku');
    
    return actions.join('\n');
  }

  private buildProgressBar(percent: number, width: number = 20): string {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    
    let color = '';
    if (percent >= 90) color = '🔴';
    else if (percent >= 75) color = '🟡';
    else color = '🟢';
    
    return `${color} ${bar} ${percent.toFixed(0)}%`;
  }

  private async executeTauri(
    input: string,
    context: PluginContext,
    start: number,
  ): Promise<PluginResult> {
    const lower = input.toLowerCase();
    const pathMatch = input.match(/(?:ścieżk[aę]|path|katalog|folder)\s+(\S+)/i);
    const targetPath = pathMatch ? pathMatch[1] : undefined;

    if (targetPath) {
      const usage = (await context.tauriInvoke!('get_disk_usage', {
        path: targetPath,
      })) as DiskPartition;
      return {
        pluginId: this.id,
        status: 'success',
        content: [
          {
            type: 'text',
            data: this.formatPartition(usage),
            title: `Dysk: ${targetPath}`,
          },
        ],
        metadata: { 
          duration_ms: Date.now() - start, 
          cached: false, 
          truncated: false,
        },
      };
    }

    const info = (await context.tauriInvoke!('get_disk_info', {})) as DiskInfo;
    return {
      pluginId: this.id,
      status: 'success',
      content: [
        {
          type: 'text',
          data: this.formatDiskInfo(info),
          title: 'Informacje o dyskach',
        },
      ],
      metadata: { 
        duration_ms: Date.now() - start, 
        cached: false, 
        truncated: false,
      },
    };
  }

  private async executeRemote(
    host: string,
    input: string,
    context: PluginContext,
    start: number,
  ): Promise<PluginResult> {
    if (!context.isTauri || !context.tauriInvoke) {
      return this.errorResult(
        `Zapytanie o dysk zdalnego hosta ${host} wymaga trybu Tauri (SSH).`,
        start,
      );
    }

    try {
      const result = (await context.tauriInvoke('ssh_execute', {
        host,
        command: 'df -h --output=source,target,fstype,size,used,avail,pcent -x tmpfs -x devtmpfs 2>/dev/null || df -h',
        user: this.extractUser(input),
        port: this.extractPort(input),
        timeout: 10,
      })) as SshResult;

      if (result.exit_code !== 0) {
        return this.errorResult(
          `SSH do ${host} zakończone z kodem ${result.exit_code}: ${result.stderr}`,
          start,
        );
      }

      const lines: string[] = [
        `💾 **Dyski na ${host}**\n`,
        '```',
        result.stdout.trim(),
        '```',
      ];

      return {
        pluginId: this.id,
        status: 'success',
        content: [{ type: 'text', data: lines.join('\n'), title: `Dyski: ${host}` }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    } catch (err) {
      return this.errorResult(
        `Nie można połączyć z ${host} przez SSH: ${err instanceof Error ? err.message : String(err)}`,
        start,
      );
    }
  }

  private browserFallback(start: number): PluginResult {
    return {
      pluginId: this.id,
      status: 'partial',
      content: [
        {
          type: 'text',
          data: '💾 **Informacje o dyskach**\n\n⚠️ Pełne informacje o dyskach dostępne tylko w trybie Tauri.\nW przeglądarce nie ma dostępu do danych systemowych.\n\n💡 Uruchom Broxeen jako aplikację desktopową, aby uzyskać szczegóły.',
        },
      ],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  private formatDiskInfo(info: DiskInfo): string {
    const lines: string[] = [];
    lines.push(`💾 **Dyski na ${info.hostname}**\n`);
    lines.push(
      `**Łącznie:** ${this.formatBytes(info.total_bytes)} | **Zajęte:** ${this.formatBytes(info.used_bytes)} (${info.use_percent.toFixed(1)}%) | **Wolne:** ${this.formatBytes(info.available_bytes)}`,
    );
    lines.push('');

    if (info.partitions.length > 0) {
      // Simplified table with progress bars
      lines.push('| Lokalizacja | Rozmiar | Zajętość | Wolne |');
      lines.push('|---|---|---|---|');
      for (const p of info.partitions) {
        const progressBar = this.buildProgressBar(p.use_percent);
        lines.push(
          `| **${p.mount_point}** | ${this.formatBytes(p.total_bytes)} | ${progressBar} | ${this.formatBytes(p.available_bytes)} |`,
        );
      }
    }

    const highUsage = info.partitions.filter((p) => p.use_percent > 85);
    if (highUsage.length > 0) {
      lines.push('');
      lines.push('⚠️ **Ostrzeżenia:**');
      for (const p of highUsage) {
        lines.push(
          `- **${p.mount_point}** — ${p.use_percent.toFixed(0)}% zajęte (${this.formatBytes(p.available_bytes)} wolne)`,
        );
      }
    }

    return lines.join('\n');
  }

  private formatPartition(p: DiskPartition): string {
    const lines: string[] = [];
    lines.push(`💾 **${p.device}** zamontowany w **${p.mount_point}**\n`);
    lines.push(`Rozmiar: ${this.formatBytes(p.total_bytes)}`);
    lines.push(`Zajęte: ${this.formatBytes(p.used_bytes)} (${p.use_percent.toFixed(1)}%)`);
    lines.push(`Wolne: ${this.formatBytes(p.available_bytes)}`);
    if (p.use_percent > 90) {
      lines.push(`\n⚠️ Dysk prawie pełny! Rozważ zwolnienie miejsca.`);
    }
    return lines.join('\n');
  }

  private formatBytes(bytes: number): string {
    if (bytes >= 1_099_511_627_776) return `${(bytes / 1_099_511_627_776).toFixed(1)} TB`;
    if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
    if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  }

  private extractRemoteHost(input: string): string | null {
    // "dysk na 192.168.1.100" or "disk info host.local"
    const patterns = [
      /(?:dysk|disk|miejsce|storage)\s+(?:na|on|w|at|host)\s+(\S+)/i,
      /(?:sprawdź|sprawdz|check)\s+dysk\s+(\S+)/i,
    ];
    for (const p of patterns) {
      const m = input.match(p);
      if (m) {
        const candidate = m[1];
        if (candidate.includes('.') || candidate.includes(':')) return candidate;
      }
    }
    return null;
  }

  private extractUser(input: string): string | undefined {
    const m = input.match(/(?:user|użytkownik|jako)\s+(\S+)/i);
    return m ? m[1] : undefined;
  }

  private extractPort(input: string): number | undefined {
    const m = input.match(/(?:port)\s+(\d+)/i);
    return m ? parseInt(m[1], 10) : undefined;
  }

  private errorResult(msg: string, start: number): PluginResult {
    return {
      pluginId: this.id,
      status: 'error',
      content: [{ type: 'text', data: msg }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  async initialize(_context: PluginContext): Promise<void> {}
  async dispose(): Promise<void> {}
}

interface DiskPartition {
  device: string;
  mount_point: string;
  fs_type: string;
  total_bytes: number;
  used_bytes: number;
  available_bytes: number;
  use_percent: number;
}

interface DiskInfo {
  hostname: string;
  partitions: DiskPartition[];
  total_bytes: number;
  used_bytes: number;
  available_bytes: number;
  use_percent: number;
}

interface SshResult {
  host: string;
  command: string;
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
}
