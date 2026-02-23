/**
 * @module plugins/system/sshPlugin
 * @description SSH plugin — handles text2ssh (natural language → SSH commands)
 * and direct SSH command execution on remote hosts.
 *
 * Intents: "ssh:execute", "ssh:connect", "ssh:test", "ssh:hosts"
 * Scope: local, network
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';
import { configStore } from '../../config/configStore';

/** Maps natural language descriptions to SSH commands */
const TEXT2SSH_PATTERNS: Array<{ patterns: RegExp[]; command: string; description: string }> = [
  {
    patterns: [/uptime/i, /jak\s+dług/i, /od\s+kiedy\s+dział/i],
    command: 'uptime',
    description: 'Czas działania systemu',
  },
  {
    patterns: [/dysk|disk|miejsce|storage|df/i],
    command: 'df -h --output=source,target,size,used,avail,pcent -x tmpfs -x devtmpfs 2>/dev/null || df -h',
    description: 'Użycie dysków',
  },
  {
    patterns: [/pamięć|pamięci|pamieci|memory|ram|free/i],
    command: 'free -h',
    description: 'Użycie pamięci RAM',
  },
  {
    patterns: [/procesy|top|cpu|obciąż|obciaz|load/i],
    command: 'top -bn1 | head -20',
    description: 'Obciążenie CPU / procesy',
  },
  {
    patterns: [/kto\s+zalogowany|who|users|użytkown/i],
    command: 'who',
    description: 'Zalogowani użytkownicy',
  },
  {
    patterns: [/sieć|network|ifconfig|ip\s+addr|interfejs/i],
    command: 'ip addr show 2>/dev/null || ifconfig',
    description: 'Interfejsy sieciowe',
  },
  {
    patterns: [/hostname|nazwa\s+host/i],
    command: 'hostname -f',
    description: 'Pełna nazwa hosta',
  },
  {
    patterns: [/system|os|uname|wersja|version/i],
    command: 'uname -a && cat /etc/os-release 2>/dev/null | head -5',
    description: 'Informacje o systemie',
  },
  {
    patterns: [/log|logi|journal|syslog/i],
    command: 'journalctl --no-pager -n 20 2>/dev/null || tail -20 /var/log/syslog 2>/dev/null || tail -20 /var/log/messages',
    description: 'Ostatnie logi systemowe',
  },
  {
    patterns: [/usługi|services|systemctl|daemon/i],
    command: 'systemctl list-units --type=service --state=running --no-pager 2>/dev/null | head -30',
    description: 'Działające usługi',
  },
  {
    patterns: [/restart|reboot|uruchom\s+ponownie/i],
    command: 'echo "UWAGA: restart wymaga potwierdzenia. Użyj: sudo reboot"',
    description: 'Restart systemu (wymaga potwierdzenia)',
  },
  {
    patterns: [/temperatura|temp|sensors/i],
    command: 'sensors 2>/dev/null || cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null | while read t; do echo "$((t/1000))°C"; done',
    description: 'Temperatura systemu',
  },
  {
    patterns: [/docker|kontener|container/i],
    command: 'docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || echo "Docker nie jest zainstalowany"',
    description: 'Kontenery Docker',
  },
  {
    patterns: [/port|nasłuchuj|listen|ss\b|netstat/i],
    command: 'ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null',
    description: 'Otwarte porty',
  },
];

export class SshPlugin implements Plugin {
  readonly id = 'ssh';
  readonly name = 'SSH / text2ssh';
  readonly version = '1.0.0';
  readonly supportedIntents = ['ssh:execute', 'ssh:connect', 'ssh:test', 'ssh:hosts'];

  async canHandle(input: string, _context: PluginContext): Promise<boolean> {
    const lower = input.toLowerCase();
    return (
      lower.includes('ssh') ||
      lower.startsWith('połącz') ||
      lower.startsWith('polacz') ||
      lower.startsWith('wykonaj na') ||
      lower.startsWith('run on') ||
      lower.includes('text2ssh') ||
      lower.includes('zdaln') ||
      /(?:sprawdź|sprawdz|check|pokaż|pokaz)\s+(?:na|on)\s+\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/i.test(input)
    );
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();
    const lower = input.toLowerCase();

    try {
      // List known SSH hosts
      if (lower.includes('ssh host') || lower.includes('znane hosty') || lower === 'ssh') {
        return await this.listKnownHosts(context, start);
      }

      // Test SSH connection
      if (lower.includes('test ssh') || lower.includes('sprawdź ssh') || lower.includes('sprawdz ssh')) {
        const host = this.extractHost(input);
        if (!host) return this.errorResult('Podaj adres hosta do testu SSH.', start);
        return await this.testConnection(host, input, context, start);
      }

      // text2ssh: detect command from natural language or execute raw
      const host = this.extractHost(input);
      if (!host) {
        const subnet = configStore.get<string>('network.defaultSubnet');
      return this.errorResult(
          `📡 **SSH — Podaj adres hosta**\n\nPrzykłady:\n- "ssh ${subnet}.100 uptime"\n- "sprawdź dysk na ${subnet}.100"\n- "text2ssh ${subnet}.1 jakie procesy działają"\n- "ssh hosty" — pokaż znane hosty`,
          start,
        );
      }

      const { command, description } = this.resolveCommand(input, host);

      if (!context.isTauri || !context.tauriInvoke) {
        return this.errorResult(
          `Wykonanie SSH na ${host} wymaga trybu Tauri (aplikacja desktopowa).`,
          start,
        );
      }

      const sshCfg = configStore.getAll().ssh;
      const result = (await context.tauriInvoke('ssh_execute', {
        host,
        command,
        user: this.extractUser(input) || sshCfg.defaultUser,
        port: this.extractPort(input) || sshCfg.defaultPort,
        timeout: sshCfg.defaultTimeoutSec,
      })) as SshExecResult;

      return this.formatSshResult(host, command, description, result, start);
    } catch (err) {
      return this.errorResult(
        `Błąd SSH: ${err instanceof Error ? err.message : String(err)}`,
        start,
      );
    }
  }

  private async listKnownHosts(context: PluginContext, start: number): Promise<PluginResult> {
    if (!context.isTauri || !context.tauriInvoke) {
      return {
        pluginId: this.id,
        status: 'partial',
        content: [{
          type: 'text',
          data: '📡 **SSH — Znane hosty**\n\n⚠️ Lista known_hosts dostępna tylko w trybie Tauri.',
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    const hosts = (await context.tauriInvoke('ssh_list_known_hosts', {})) as KnownHost[];

    if (hosts.length === 0) {
      return {
        pluginId: this.id,
        status: 'success',
        content: [{
          type: 'text',
          data: `📡 **SSH — Znane hosty**\n\nBrak wpisów w known_hosts.\n\n💡 Połącz się z hostem: "ssh ${configStore.get<string>('network.defaultSubnet')}.100 uptime"`,
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    const lines: string[] = [`📡 **SSH — Znane hosty (${hosts.length})**\n`];
    lines.push('| Host | Typ klucza |');
    lines.push('|---|---|');
    for (const h of hosts.slice(0, 50)) {
      lines.push(`| ${h.host} | ${h.key_type} |`);
    }
    if (hosts.length > 50) {
      lines.push(`\n...i ${hosts.length - 50} więcej`);
    }

    lines.push('\n💡 **Sugerowane akcje:**');
    const sampleHosts = hosts.slice(0, 3).map((h) => h.host);
    for (const h of sampleHosts) {
      lines.push(`- "ssh ${h} uptime"`);
    }

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data: lines.join('\n'), title: 'SSH Known Hosts' }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  private async testConnection(
    host: string,
    input: string,
    context: PluginContext,
    start: number,
  ): Promise<PluginResult> {
    if (!context.isTauri || !context.tauriInvoke) {
      return this.errorResult('Test SSH wymaga trybu Tauri.', start);
    }

    const result = (await context.tauriInvoke('ssh_test_connection', {
      host,
      user: this.extractUser(input),
      port: this.extractPort(input),
    })) as SshTestResult;

    const lines: string[] = [`📡 **Test SSH: ${host}:${result.port}**\n`];
    lines.push(result.reachable ? '✅ Port SSH dostępny' : '❌ Port SSH niedostępny');
    if (result.reachable) {
      lines.push(result.auth_ok ? '✅ Autoryzacja OK' : '❌ Autoryzacja nieudana');
    }
    if (result.ssh_version) lines.push(`Wersja: ${result.ssh_version}`);
    lines.push(`Czas: ${result.duration_ms}ms`);
    if (result.error) lines.push(`\n⚠️ ${result.error}`);

    if (result.auth_ok) {
      lines.push('\n💡 **Sugerowane akcje:**');
      lines.push(`- "ssh ${host} uptime"`);
      lines.push(`- "ssh ${host} df -h"`);
      lines.push(`- "text2ssh ${host} jakie procesy działają"`);
    }

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data: lines.join('\n'), title: `SSH Test: ${host}` }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  private resolveCommand(
    input: string,
    host: string,
  ): { command: string; description: string } {
    // Remove host/ssh prefix to get the command part
    let cmdPart = input
      .replace(/\b(ssh|text2ssh|połącz|polacz|wykonaj\s+na|run\s+on)\b/gi, '')
      .replace(new RegExp(`\\b${host.replace(/\./g, '\\.')}\\b`), '')
      .replace(/\b(user|użytkownik|jako)\s+\S+/gi, '')
      .replace(/\b(port)\s+\d+/gi, '')
      .trim();

    // If it looks like a raw command, use it directly
    if (this.looksLikeShellCommand(cmdPart)) {
      return { command: cmdPart, description: 'Komenda użytkownika' };
    }

    // text2ssh: try matching natural language patterns
    for (const entry of TEXT2SSH_PATTERNS) {
      for (const pattern of entry.patterns) {
        if (pattern.test(cmdPart) || pattern.test(input)) {
          return { command: entry.command, description: entry.description };
        }
      }
    }

    // Default: if we have text but no match, wrap it in a safe echo
    if (cmdPart.length > 0) {
      return { command: cmdPart, description: 'Komenda' };
    }

    return { command: 'uptime && hostname -f', description: 'Status systemu' };
  }

  private looksLikeShellCommand(text: string): boolean {
    const shellIndicators = [
      /^(ls|cat|grep|find|echo|head|tail|wc|df|du|ps|top|free|who|uname|hostname|systemctl|journalctl|docker|ss|netstat|ip|ifconfig|ping|curl|wget|apt|yum|dnf|sensors|uptime)\b/i,
      /\|/,
      /&&/,
      /;/,
      />/,
      /</,
      /\$\(/,
    ];
    return shellIndicators.some((p) => p.test(text.trim()));
  }

  private formatSshResult(
    host: string,
    command: string,
    description: string,
    result: SshExecResult,
    start: number,
  ): PluginResult {
    const lines: string[] = [];
    lines.push(`📡 **SSH: ${host}** — ${description}\n`);
    lines.push(`Komenda: \`${command}\``);
    lines.push(`Kod wyjścia: ${result.exit_code === 0 ? '✅ 0' : `❌ ${result.exit_code}`}`);
    lines.push(`Czas: ${result.duration_ms}ms\n`);

    if (result.stdout.trim()) {
      lines.push('**Wynik:**');
      lines.push('```');
      // Truncate long output
      const stdout = result.stdout.trim();
      if (stdout.length > 3000) {
        lines.push(stdout.substring(0, 3000));
        lines.push(`\n... (skrócono, łącznie ${stdout.length} znaków)`);
      } else {
        lines.push(stdout);
      }
      lines.push('```');
    }

    if (result.stderr.trim() && result.exit_code !== 0) {
      lines.push('\n**Błędy:**');
      lines.push('```');
      lines.push(result.stderr.trim().substring(0, 1000));
      lines.push('```');
    }

    // Smart error diagnosis and suggestions
    const errorAnalysis = this.analyzeSshError(result.stderr, result.exit_code, host);
    if (errorAnalysis) {
      lines.push(`\n🔍 **Diagnoza:** ${errorAnalysis.diagnosis}`);
      if (errorAnalysis.suggestions.length > 0) {
        lines.push('\n💡 **Sugerowane akcje:**');
        errorAnalysis.suggestions.forEach(suggestion => {
          lines.push(`- ${suggestion}`);
        });
      }
    } else {
      // Default suggestions for successful connections
      lines.push('\n💡 **Sugerowane akcje:**');
      lines.push(`- "ssh ${host} df -h" — Dyski`);
      lines.push(`- "ssh ${host} free -h" — Pamięć`);
      lines.push(`- "ssh ${host} top -bn1 | head -10" — Procesy`);
    }

    return {
      pluginId: this.id,
      status: result.exit_code === 0 ? 'success' : 'partial',
      content: [{ type: 'text', data: lines.join('\n'), title: `SSH: ${host}` }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  private analyzeSshError(stderr: string, exitCode: number, host: string): { diagnosis: string; suggestions: string[] } | null {
    if (exitCode === 0) return null; // No error

    const errorLower = stderr.toLowerCase();
    const suggestions: string[] = [];

    // Connection refused
    if (errorLower.includes('connection refused')) {
      suggestions.push(`"ping ${host}" — Sprawdź czy host jest online`);
      suggestions.push(`"skanuj porty ${host}" — Sprawdź otwarte porty`);
      suggestions.push(`"przeglądaj http://${host}" — Sprawdź interfejs web`);
      return {
        diagnosis: 'SSH nie jest dostępne na tym urządzeniu. Może to być kamera, router lub urządzenie IoT bez serwera SSH.',
        suggestions
      };
    }

    // Authentication failed
    if (errorLower.includes('permission denied') || errorLower.includes('authentication failed')) {
      suggestions.push(`"ssh ${host} user admin" — Spróbuj innego użytkownika`);
      suggestions.push(`"ssh ${host} port 2222" — Spróbuj innego portu SSH`);
      suggestions.push(`"test ssh ${host}" — Przetestuj połączenie`);
      return {
        diagnosis: 'Błąd autentykacji. Sprawdź nazwę użytkownika, hasło lub klucz SSH.',
        suggestions
      };
    }

    // Host key verification
    if (errorLower.includes('host key verification failed')) {
      suggestions.push(`"ssh ${host}" — Usuń stary klucz hosta i połącz ponownie`);
      return {
        diagnosis: 'Weryfikacja klucza hosta nie powiodła się. Klucz hosta mógł ulec zmianie.',
        suggestions
      };
    }

    // Network timeout
    if (errorLower.includes('connection timed out') || errorLower.includes('timeout')) {
      suggestions.push(`"ping ${host}" — Sprawdź łączność sieciową`);
      suggestions.push(`"skanuj ${host}" — Odkryj urządzenie w sieci`);
      return {
        diagnosis: 'Przekroczono czas oczekiwania na połączenie. Sprawdź połączenie sieciowe i firewall.',
        suggestions
      };
    }

    // No route to host
    if (errorLower.includes('no route to host')) {
      const subnet = host.split('.').slice(0, 3).join('.');
      suggestions.push(`"ping ${host}" — Sprawdź routing`);
      suggestions.push(`"skanuj ${subnet}" — Zeskanuj podsieć`);
      return {
        diagnosis: 'Brak trasy do hosta. Sprawdź konfigurację sieci i czy host jest w tej samej podsieci.',
        suggestions
      };
    }

    // Command not found (SSH worked but command failed)
    if (exitCode !== 0 && exitCode !== 255 && !errorLower.includes('ssh') && !errorLower.includes('connection')) {
      suggestions.push(`"ssh ${host} uptime" — Sprawdź podstawowy status`);
      suggestions.push(`"ssh ${host} ls -la" — Przeglądaj pliki`);
      return {
        diagnosis: 'Połączenie SSH działa, ale komenda nie jest dostępna na tym urządzeniu.',
        suggestions
      };
    }

    // Generic SSH error
    suggestions.push(`"test ssh ${host}" — Przetestuj połączenie SSH`);
    suggestions.push(`"skanuj porty ${host}" — Sprawdź dostępne porty`);
    suggestions.push(`"przeglądaj http://${host}" — Sprawdź interfejs web`);

    return {
      diagnosis: 'Błąd połączenia SSH. Sprawdź konfigurację sieci, dostępność hosta i uprawnienia.',
      suggestions
    };
  }

  private extractHost(input: string): string | null {
    // IP address
    const ipMatch = input.match(/\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
    if (ipMatch) return ipMatch[1];
    // hostname.domain
    const hostMatch = input.match(
      /(?:ssh|text2ssh|połącz|polacz|wykonaj\s+na|run\s+on|na|on|host)\s+([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+)/i,
    );
    if (hostMatch) return hostMatch[1];
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

interface SshExecResult {
  host: string;
  command: string;
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms: number;
}

interface SshTestResult {
  host: string;
  port: number;
  reachable: boolean;
  auth_ok: boolean;
  ssh_version: string | null;
  duration_ms: number;
  error: string | null;
}

interface KnownHost {
  host: string;
  key_type: string;
}
