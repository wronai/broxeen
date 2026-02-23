/**
 * @module plugins/email/emailPlugin
 * @description Email integration plugin — send files, poll inbox, configure email.
 * Supports SMTP sending with attachments, IMAP inbox polling with summaries,
 * and configurable 10-minute auto-polling with chat-based parameter changes.
 *
 * Intents: "email:send", "email:inbox", "email:config", "email:poll"
 * Scope: local
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';
import { configStore } from '../../config/configStore';

export interface EmailConfig {
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_password: string;
  imap_host: string;
  imap_port: number;
  from_address: string;
  use_tls: boolean;
}

export interface EmailMessage {
  id: string;
  from: string;
  to: string[];
  subject: string;
  body: string;
  date: string | null;
  has_attachments: boolean;
  is_read: boolean;
}

export interface InboxSummary {
  total_messages: number;
  unread_count: number;
  recent_messages: EmailMessage[];
  summary_text: string;
  poll_time: string;
}

export class EmailPlugin implements Plugin {
  readonly id = 'email';
  readonly name = 'Email';
  readonly version = '1.0.0';
  readonly supportedIntents = ['email:send', 'email:inbox', 'email:config', 'email:poll'];

  private pollIntervalId: ReturnType<typeof setInterval> | null = null;
  private pollIntervalMs: number = 10 * 60 * 1000; // 10 minutes default
  private pollCallback: ((summary: string) => void) | null = null;

  async canHandle(input: string, _context: PluginContext): Promise<boolean> {
    const lower = input.toLowerCase();
    return (
      lower.includes('email') ||
      lower.includes('e-mail') ||
      lower.includes('mail') ||
      lower.includes('wyślij') && (lower.includes('plik') || lower.includes('mail')) ||
      lower.includes('wyslij') && (lower.includes('plik') || lower.includes('mail')) ||
      lower.includes('skrzynk') ||
      lower.includes('inbox') ||
      lower.includes('poczta') ||
      lower.includes('poczt') ||
      lower.includes('wiadomoś') ||
      lower.includes('wiadomos') ||
      /konfiguruj\s*(email|e-mail|poczt)/i.test(lower) ||
      /sprawdź\s*(email|e-mail|poczt|skrzynk)/i.test(lower) ||
      /sprawdz\s*(email|e-mail|poczt|skrzynk)/i.test(lower)
    );
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();
    const lower = input.toLowerCase();

    try {
      // Determine which email action to perform
      if (this.isConfigRequest(lower)) {
        return this.handleConfig(input, start);
      }

      if (this.isSendRequest(lower)) {
        return await this.handleSend(input, context, start);
      }

      if (this.isPollConfigRequest(lower)) {
        return this.handlePollConfig(input, start);
      }

      if (this.isInboxRequest(lower)) {
        return await this.handleInbox(context, start);
      }

      // Default: show inbox
      return await this.handleInbox(context, start);
    } catch (err) {
      return this.errorResult(
        `Błąd email: ${err instanceof Error ? err.message : String(err)}`,
        start,
      );
    }
  }

  // ── Request classification ──────────────────────────────────

  private isConfigRequest(lower: string): boolean {
    return (
      /konfiguruj\s*(email|e-mail|poczt)/i.test(lower) ||
      /config.*email/i.test(lower) ||
      /ustaw\s*(email|e-mail|poczt)/i.test(lower) ||
      /email.*config/i.test(lower) ||
      /testuj\s*(email|e-mail|poczt)/i.test(lower)
    );
  }

  private isSendRequest(lower: string): boolean {
    return (
      lower.includes('wyślij') ||
      lower.includes('wyslij') ||
      lower.includes('send') ||
      lower.includes('prześlij') ||
      lower.includes('przeslij') ||
      (lower.includes('mail') && lower.includes('plik'))
    );
  }

  private isInboxRequest(lower: string): boolean {
    return (
      lower.includes('skrzynk') ||
      lower.includes('inbox') ||
      lower.includes('poczta') ||
      lower.includes('poczt') ||
      lower.includes('wiadomoś') ||
      lower.includes('wiadomos') ||
      lower.includes('sprawdź email') ||
      lower.includes('sprawdz email') ||
      lower.includes('odczytaj email') ||
      lower.includes('check email') ||
      lower.includes('co w email') ||
      lower.includes('nowe email') ||
      lower.includes('nowe wiadom')
    );
  }

  private isPollConfigRequest(lower: string): boolean {
    return (
      /zmień.*interwał.*email/i.test(lower) ||
      /zmien.*interwal.*email/i.test(lower) ||
      /ustaw.*polling.*email/i.test(lower) ||
      /email.*co\s+\d+\s*(minut|min|sekund|sec)/i.test(lower) ||
      /odpytuj.*co\s+\d+/i.test(lower) ||
      /polling.*\d+/i.test(lower) ||
      /email.*interwał/i.test(lower) ||
      /email.*interwal/i.test(lower)
    );
  }

  // ── Handlers ────────────────────────────────────────────────

  private handleConfig(_input: string, start: number): PluginResult {
    const currentConfig = this.getEmailConfig();
    const isConfigured = !!(currentConfig.smtp_host && currentConfig.smtp_user);

    let text: string;
    if (isConfigured) {
      text = `📧 **Konfiguracja email**\n\n`;
      text += `✅ Email jest skonfigurowany:\n`;
      text += `- **SMTP:** ${currentConfig.smtp_host}:${currentConfig.smtp_port}\n`;
      text += `- **IMAP:** ${currentConfig.imap_host}:${currentConfig.imap_port}\n`;
      text += `- **Użytkownik:** ${currentConfig.smtp_user}\n`;
      text += `- **Adres nadawcy:** ${currentConfig.from_address}\n`;
      text += `- **TLS:** ${currentConfig.use_tls ? 'tak' : 'nie'}\n`;
      text += `- **Polling:** co ${Math.round(this.pollIntervalMs / 60000)} minut\n`;
      text += `\n💡 **Sugerowane akcje:**\n`;
      text += `- "testuj email" — przetestuj połączenie\n`;
      text += `- "sprawdź skrzynkę" — odczytaj wiadomości\n`;
      text += `- "email co 5 minut" — zmień interwał pollingu\n`;
    } else {
      text = `📧 **Konfiguracja email**\n\n`;
      text += `⚠️ Email nie jest jeszcze skonfigurowany.\n\n`;
      text += `Ustaw konfigurację email w następujący sposób:\n\n`;
      text += `\`\`\`\n`;
      text += `konfiguruj email smtp=smtp.gmail.com:587 imap=imap.gmail.com:993 user=twoj@gmail.com password=haslo-aplikacji from=twoj@gmail.com tls=true\n`;
      text += `\`\`\`\n\n`;
      text += `💡 **Dla Gmail** użyj [hasła aplikacji](https://myaccount.google.com/apppasswords).\n`;
      text += `💡 **Dla Outlook** użyj smtp=smtp.office365.com:587, imap=outlook.office365.com:993\n`;
    }

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data: text }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  private async handleSend(
    input: string,
    context: PluginContext,
    start: number,
  ): Promise<PluginResult> {
    if (!context.isTauri || !context.tauriInvoke) {
      return this.browserFallback(start);
    }

    const emailConfig = this.getEmailConfig();
    if (!emailConfig.smtp_host || !emailConfig.smtp_user) {
      return {
        pluginId: this.id,
        status: 'error',
        content: [{
          type: 'text',
          data: '📧 Email nie jest skonfigurowany. Użyj komendy `konfiguruj email` aby ustawić SMTP.',
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    const { to, subject, body, attachments } = this.parseSendParams(input);

    if (!to) {
      return {
        pluginId: this.id,
        status: 'error',
        content: [{
          type: 'text',
          data: '❓ Nie podano adresu email odbiorcy.\n\n💡 Przykład: `wyślij plik /home/user/raport.pdf na email jan@firma.pl`',
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    const result = (await context.tauriInvoke('email_send', {
      to: [to],
      subject: subject || `Broxeen: Pliki z ${new Date().toLocaleDateString('pl-PL')}`,
      body: body || 'Wiadomość wysłana z Broxeen.',
      attachments: attachments.length > 0 ? attachments : undefined,
      config: emailConfig,
    })) as string;

    return {
      pluginId: this.id,
      status: 'success',
      content: [{
        type: 'text',
        data: `✅ **Email wysłany**\n\n${result}\n\n💡 **Sugerowane akcje:**\n- "sprawdź skrzynkę" — sprawdź odpowiedź`,
      }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  private async handleInbox(
    context: PluginContext,
    start: number,
  ): Promise<PluginResult> {
    if (!context.isTauri || !context.tauriInvoke) {
      return this.browserFallback(start);
    }

    const emailConfig = this.getEmailConfig();
    if (!emailConfig.imap_host || !emailConfig.smtp_user) {
      return {
        pluginId: this.id,
        status: 'error',
        content: [{
          type: 'text',
          data: '📧 Email nie jest skonfigurowany. Użyj komendy `konfiguruj email` aby ustawić IMAP.',
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    const summary = (await context.tauriInvoke('email_poll_inbox', {
      maxMessages: 10,
      config: emailConfig,
    })) as InboxSummary;

    let text = summary.summary_text;
    text += `\n\n⏰ Sprawdzono: ${summary.poll_time}`;
    text += `\n\n💡 **Sugerowane akcje:**`;
    text += `\n- "email co 5 minut" — zmień częstotliwość sprawdzania`;
    text += `\n- "wyślij email do jan@firma.pl" — napisz wiadomość`;

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data: text }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  private handlePollConfig(input: string, start: number): PluginResult {
    const minuteMatch = input.match(/(\d+)\s*(minut|min)/i);
    const secondMatch = input.match(/(\d+)\s*(sekund|sec)/i);

    let newIntervalMs: number;
    let label: string;

    if (minuteMatch) {
      const minutes = parseInt(minuteMatch[1], 10);
      newIntervalMs = Math.max(60_000, minutes * 60_000); // min 1 minute
      label = `${minutes} minut`;
    } else if (secondMatch) {
      const seconds = parseInt(secondMatch[1], 10);
      newIntervalMs = Math.max(30_000, seconds * 1000); // min 30 seconds
      label = `${seconds} sekund`;
    } else {
      return {
        pluginId: this.id,
        status: 'error',
        content: [{
          type: 'text',
          data: `❓ Nie rozpoznano interwału.\n\n💡 Przykłady:\n- "email co 5 minut"\n- "odpytuj co 30 sekund"\n- "polling 15 min"`,
        }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    this.pollIntervalMs = newIntervalMs;
    configStore.set('email.pollIntervalMs', newIntervalMs);

    // Restart polling if active
    if (this.pollIntervalId !== null) {
      this.stopPolling();
      this.startPolling();
    }

    return {
      pluginId: this.id,
      status: 'success',
      content: [{
        type: 'text',
        data: `✅ **Interwał pollingu email** zmieniony na **${label}**\n\nSkrzynka będzie sprawdzana co ${label}.\n\n💡 **Sugerowane akcje:**\n- "sprawdź skrzynkę" — sprawdź teraz\n- "zatrzymaj polling email" — wyłącz auto-sprawdzanie`,
      }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  // ── Polling ─────────────────────────────────────────────────

  startPolling(callback?: (summary: string) => void): void {
    if (this.pollIntervalId !== null) return;
    if (callback) this.pollCallback = callback;

    this.pollIntervalMs = configStore.get<number>('email.pollIntervalMs') || 10 * 60 * 1000;

    console.log(`📧 Email polling started (every ${Math.round(this.pollIntervalMs / 60000)} min)`);

    this.pollIntervalId = setInterval(async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const config = this.getEmailConfig();
        if (!config.imap_host || !config.smtp_user) return;

        const summary = (await invoke('email_poll_inbox', {
          maxMessages: 5,
          config,
        })) as InboxSummary;

        if (this.pollCallback && summary.unread_count > 0) {
          this.pollCallback(summary.summary_text);
        }
      } catch (err) {
        console.warn('Email polling failed:', err);
      }
    }, this.pollIntervalMs);
  }

  stopPolling(): void {
    if (this.pollIntervalId !== null) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
      console.log('📧 Email polling stopped');
    }
  }

  // ── Helpers ─────────────────────────────────────────────────

  private getEmailConfig(): EmailConfig {
    return {
      smtp_host: configStore.get<string>('email.smtpHost') || '',
      smtp_port: configStore.get<number>('email.smtpPort') || 587,
      smtp_user: configStore.get<string>('email.smtpUser') || '',
      smtp_password: configStore.get<string>('email.smtpPassword') || '',
      imap_host: configStore.get<string>('email.imapHost') || '',
      imap_port: configStore.get<number>('email.imapPort') || 993,
      from_address: configStore.get<string>('email.fromAddress') || '',
      use_tls: configStore.get<boolean>('email.useTls') ?? true,
    };
  }

  private parseSendParams(input: string): {
    to: string | null;
    subject: string | null;
    body: string | null;
    attachments: string[];
  } {
    // Extract email address
    const emailMatch = input.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    const to = emailMatch ? emailMatch[0] : null;

    // Extract file paths (attachments)
    const attachments: string[] = [];
    const pathPatterns = [
      /(\/[\w\-./]+\.\w+)/g,
      /(~\/[\w\-./]+\.\w+)/g,
    ];
    for (const pattern of pathPatterns) {
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(input)) !== null) {
        attachments.push(m[1]);
      }
    }

    // Extract subject
    const subjectMatch = input.match(/(?:temat|subject)\s*[:=]\s*"?([^"]+)"?/i);
    const subject = subjectMatch ? subjectMatch[1].trim() : null;

    // Extract body
    const bodyMatch = input.match(/(?:treść|body|wiadomość)\s*[:=]\s*"?([^"]+)"?/i);
    const body = bodyMatch ? bodyMatch[1].trim() : null;

    return { to, subject, body, attachments };
  }

  private browserFallback(start: number): PluginResult {
    return {
      pluginId: this.id,
      status: 'partial',
      content: [{
        type: 'text',
        data: '📧 **Integracja email**\n\n⚠️ Funkcje email są dostępne tylko w trybie Tauri (aplikacja desktopowa).\nW przeglądarce nie ma dostępu do SMTP/IMAP.\n\n💡 Uruchom Broxeen jako aplikację desktopową.',
      }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  private errorResult(msg: string, start: number): PluginResult {
    return {
      pluginId: this.id,
      status: 'error',
      content: [{ type: 'text', data: msg }],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
    };
  }

  async initialize(_context: PluginContext): Promise<void> {
    console.log('EmailPlugin initialized');
    // Load polling interval from config
    this.pollIntervalMs = configStore.get<number>('email.pollIntervalMs') || 10 * 60 * 1000;
  }

  async dispose(): Promise<void> {
    this.stopPolling();
    console.log('EmailPlugin disposed');
  }
}
