import { Plugin, PluginContext, type PluginResult } from "../../core/types";
import { createScopedLogger } from "../../lib/logger";
import { configStore } from "../../config/configStore";

// Log management patterns
const LOG_COMMANDS = {
  DOWNLOAD_LOGS: [
    /pobierz\s+logi/i,
    /exportuj\s+logi/i,
    /zapisz\s+logi/i,
    /logi.*pobierz/i,
    /logi.*export/i,
    /logi.*zapisz/i,
    /pokaz.*logi/i,
    /log.*download/i,
  ],
  CLEAR_LOGS: [
    /wyczyść\s+logi/i,
    /usuń\s+logi/i,
    /clear\s+log/i,
    /logi.*wyczyść/i,
    /logi.*usuń/i,
  ],
  SHOW_LOG_LEVEL: [
    /poziom\s+logów/i,
    /log.*level/i,
    /ustaw.*log/i,
    /log.*ustaw/i,
  ],
} as const;

type LogCommandAction = 'download_logs' | 'clear_logs' | 'show_log_level';

interface LogCommand {
  action: LogCommandAction;
  patterns: RegExp[];
  response: string;
}

const COMMANDS: LogCommand[] = [
  {
    action: 'download_logs',
    patterns: [...LOG_COMMANDS.DOWNLOAD_LOGS],
    response: '📥 Przygotowuję logi do pobrania...',
  },
  {
    action: 'clear_logs',
    patterns: [...LOG_COMMANDS.CLEAR_LOGS],
    response: '🧹 Czyśzczenie logów...',
  },
  {
    action: 'show_log_level',
    patterns: [...LOG_COMMANDS.SHOW_LOG_LEVEL],
    response: 'ℹ️ Sprawdzam poziom logów...',
  },
];

export class LogsPlugin implements Plugin {
  readonly id = "logs";
  readonly name = "logs";
  readonly version = "1.0.0";
  readonly description = "Log management and export functionality";
  readonly supportedIntents = ["logs:download", "logs:clear", "logs:level"];

  private context?: PluginContext;
  private logger = createScopedLogger("LogsPlugin");

  async initialize(context: PluginContext): Promise<void> {
    this.context = context;
    this.logger.info("Logs plugin initialized");
  }

  async canHandle(query: string, context: PluginContext): Promise<boolean> {
    const lowerQuery = query.toLowerCase().trim();
    return COMMANDS.some(cmd =>
      cmd.patterns.some(pattern => pattern.test(lowerQuery))
    );
  }

  async execute(query: string, context?: PluginContext): Promise<PluginResult> {
    if (!this.context) {
      throw new Error("Plugin not initialized");
    }

    const lowerQuery = query.toLowerCase().trim();

    // Find matching command
    const command = COMMANDS.find(cmd =>
      cmd.patterns.some(pattern => pattern.test(lowerQuery))
    );

    if (!command) {
      return {
        pluginId: this.name,
        status: 'error',
        content: [{ type: 'text' as const, data: 'Nie rozpoznano komendy logów' }],
        metadata: {
          duration_ms: 0,
          cached: false,
          truncated: false,
        }
      };
    }

    try {
      const result = await this.executeCommand(command.action, query);

      return {
        pluginId: this.name,
        status: 'success',
        content: [{
          type: 'text' as const,
          data: result,
        }],
        metadata: {
          duration_ms: 0,
          cached: false,
          truncated: false,
        },
      };
    } catch (error) {
      this.logger.error("Failed to execute log command", {
        action: command.action,
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        pluginId: this.name,
        status: 'error',
        content: [{ type: 'text' as const, data: `Błąd podczas wykonywania komendy: ${error instanceof Error ? error.message : String(error)}` }],
        metadata: {
          duration_ms: 0,
          cached: false,
          truncated: false,
        }
      };
    }
  }

  private async executeCommand(action: LogCommandAction, query: string): Promise<string> {
    switch (action) {
      case 'download_logs':
        return await this.downloadLogs();

      case 'clear_logs':
        return await this.clearLogs();

      case 'show_log_level':
        return await this.showLogLevel();

      default:
        throw new Error(`Unknown log command action: ${action}`);
    }
  }

  private async downloadLogs(): Promise<string> {
    try {
      // Get current log level
      const currentLogLevel = await configStore.get('log_level') || 'info';

      // Collect console logs (limited to recent entries)
      const consoleLogs = this.collectConsoleLogs();

      // Get application info
      const appInfo = {
        timestamp: new Date().toISOString(),
        version: await this.getAppVersion(),
        logLevel: currentLogLevel,
        userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : 'Tauri Desktop',
        url: typeof window !== 'undefined' ? window.location.href : 'N/A',
      };

      // Create log file content
      const logContent = this.formatLogFile(appInfo, consoleLogs);

      // Create and download file
      const blob = new Blob([logContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      const filename = `broxeen-logs-${new Date().toISOString().slice(0, 10)}.txt`;

      if (typeof window !== 'undefined') {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.logger.info("Logs downloaded successfully", { filename });
        return `✅ Logi zostały pobrane jako plik: ${filename}`;
      } else {
        // Tauri environment - return content for manual save
        return `📋 Logi Broxeen (${appInfo.timestamp}):\n\n${logContent}`;
      }
    } catch (error) {
      this.logger.error("Failed to download logs", { error });
      throw error;
    }
  }

  private collectConsoleLogs(): Array<{ timestamp: string; level: string; message: string }> {
    // This is a simplified version - in production, you might want to
    // implement proper log collection from your logging system
    const logs: Array<{ timestamp: string; level: string; message: string }> = [];

    // Add some basic application logs
    logs.push({
      timestamp: new Date().toISOString(),
      level: 'INFO',
      message: 'Broxeen v2.1 - AI-powered camera monitoring system',
    });

    logs.push({
      timestamp: new Date().toISOString(),
      level: 'INFO',
      message: 'Log export requested by user',
    });

    // In a real implementation, you would collect actual logs from your logger
    return logs;
  }

  private formatLogFile(appInfo: any, consoleLogs: Array<{ timestamp: string; level: string; message: string }>): string {
    let content = '';

    // Header
    content += '='.repeat(80) + '\n';
    content += 'BROXEEN LOGS EXPORT\n';
    content += '='.repeat(80) + '\n\n';

    // App info
    content += 'APPLICATION INFO:\n';
    content += '-'.repeat(40) + '\n';
    content += `Timestamp: ${appInfo.timestamp}\n`;
    content += `Version: ${appInfo.version}\n`;
    content += `Log Level: ${appInfo.logLevel}\n`;
    content += `User Agent: ${appInfo.userAgent}\n`;
    content += `URL: ${appInfo.url}\n\n`;

    // Console logs
    content += 'CONSOLE LOGS:\n';
    content += '-'.repeat(40) + '\n';

    consoleLogs.forEach(log => {
      content += `[${log.timestamp}] ${log.level}: ${log.message}\n`;
    });

    // Footer
    content += '\n' + '='.repeat(80) + '\n';
    content += 'END OF LOG EXPORT\n';
    content += '='.repeat(80) + '\n';

    return content;
  }

  private async clearLogs(): Promise<string> {
    // In a real implementation, you would clear your log storage
    // For now, just simulate clearing browser console
    if (typeof window !== 'undefined' && window.console) {
      console.clear();
    }

    this.logger.info("Logs cleared by user request");
    return '✅ Logi zostały wyczyszczone';
  }

  private async showLogLevel(): Promise<string> {
    const currentLogLevel = await configStore.get('log_level') || 'info';

    const levelDescriptions = {
      error: 'ERROR - Tylko błędy krytyczne',
      warn: 'WARN - Ostrzeżenia i błędy',
      info: 'INFO - Informacje, ostrzeżenia i błędy (domyślny)',
      debug: 'DEBUG - Wszystkie komunikaty (szczegółowe)',
    };

    const description = levelDescriptions[currentLogLevel as keyof typeof levelDescriptions] || 'Nieznany poziom';
    const upperLevel = String(currentLogLevel).toUpperCase();

    return `ℹ️ Aktualny poziom logów: **${upperLevel}**\n\n${description}`;
  }

  private async getAppVersion(): Promise<string> {
    try {
      // Try to get version from package.json or VERSION file
      const response = await fetch('/VERSION');
      if (response.ok) {
        return await response.text();
      }
    } catch (error) {
      // Fallback
    }

    return '2.1.0'; // Default version
  }

  async dispose(): Promise<void> {
    this.logger.info("Logs plugin disposed");
  }
}
