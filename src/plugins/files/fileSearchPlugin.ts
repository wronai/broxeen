/**
 * @module plugins/files/fileSearchPlugin
 * @description Local file search plugin — searches files on local disk via Tauri backend.
 * Supports searching by name, extension, path. Returns results with previews.
 * Results display: ≤3 = grid thumbnails, 4-10 = file list, >10 = ask user to clarify.
 *
 * Intents: "file:search", "file:read", "file:open"
 * Scope: local
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';
import { getSystemContext } from '../../core/systemContext';

export interface FileSearchResult {
  path: string;
  name: string;
  extension: string;
  size_bytes: number;
  modified: string | null;
  file_type: string;
  is_dir: boolean;
  preview: string | null;
  mime_type: string;
}

export interface FileSearchResponse {
  results: FileSearchResult[];
  total_found: number;
  search_path: string;
  query: string;
  duration_ms: number;
  truncated: boolean;
}

export interface FileContentResponse {
  path: string;
  name: string;
  content: string;
  size_bytes: number;
  mime_type: string;
  truncated: boolean;
}

export class FileSearchPlugin implements Plugin {
  readonly id = 'file-search';
  readonly name = 'File Search';
  readonly version = '1.0.0';
  readonly supportedIntents = ['file:search', 'file:read', 'file:open'];

  // ── Data-driven command routing table ─────────────────────────────────
  // Each entry: [pattern, handler-key]. Checked in order; first match wins.
  private static readonly ROUTE_TABLE: ReadonlyArray<[RegExp, string]> = [
    // Read file content (highest priority)
    [/\bco\s+jest\s+w\s+pliku\b/i, 'read'],
    [/\bco\s+zawiera\b/i, 'read'],
    [/\bprzeczytaj\s+plik\b/i, 'read'],
    [/\bodczytaj\s+plik\b/i, 'read'],
    [/\bpokaż\s+zawartość\b/i, 'read'],
    [/\bpokaz\s+zawartosc\b/i, 'read'],
    [/\botwórz\s+plik\b/i, 'read'],
    [/\botworz\s+plik\b/i, 'read'],
    [/\bread\s+file\b/i, 'read'],
    // Search files (default)
    [/\bznajd[źz]\s+plik\b/i, 'search'],
    [/\bwyszukaj\s+plik\b/i, 'search'],
    [/\bszukaj\s+plik\b/i, 'search'],
    [/\bznajd[źz]\s+dokument\b/i, 'search'],
    [/\bwyszukaj\s+dokument\b/i, 'search'],
    [/\bszukaj\s+dokument\b/i, 'search'],
    [/\bpokaż\s+plik\b/i, 'search'],
    [/\bpokaz\s+plik\b/i, 'search'],
    [/\blista\s+plik[óo]?w\b/i, 'search'],
    [/\bwylistuj\s+plik\b/i, 'search'],
    [/\bco\s+(jest|mam|znajduje\s+się)\s+(w|na)\s+(folderze|katalogu|dysku)/i, 'search'],
    [/\bzawarto[śs][ćc]\s+(folderu|katalogu|dysku)/i, 'search'],
    [/\bplik[iy]?\s+(w|na|z)\s+(folderze|katalogu|dysku|komputerze|pulpicie)/i, 'search'],
    [/\bdokument[yów]?\s+(w|na|z)\s+(folderze|katalogu|dysku|komputerze|pulpicie)/i, 'search'],
    [/(folder|katalog|pulpit)\s+(usera|u[żz]ytkownika|domowy|home)/i, 'search'],
    [/\bplik[iy]?\s+(usera|u[żz]ytkownika)/i, 'search'],
    [/\bls\s+(~|\/home|\/)/i, 'search'],
    [/\blist\s+(files|directory|folder)/i, 'search'],
    [/\bpoka[żz]\s+(folder|katalog)/i, 'search'],
    [/\bco\s+mam\s+na\s+dysku/i, 'search'],
    [/\bprzejrzyj\s+(pliki|folder|katalog)/i, 'search'],
    [/\bwy[śs]wietl\s+plik/i, 'search'],
    [/\bfile\s+search\b/i, 'search'],
    [/\bfind\s+file\b/i, 'search'],
    [/\bsearch\s+file\b/i, 'search'],
  ];

  // All patterns that canHandle should match (includes ROUTE_TABLE + general keywords)
  private static readonly CAN_HANDLE_KEYWORDS: readonly string[] = [
    'znajdź plik', 'znajdz plik', 'wyszukaj plik', 'szukaj plik',
    'szukaj dokument', 'znajdź dokument', 'znajdz dokument', 'wyszukaj dokument',
    'pokaż plik', 'pokaz plik', 'otwórz plik', 'otworz plik',
    'co jest w pliku', 'co zawiera plik', 'przeczytaj plik', 'odczytaj plik',
    'file search', 'find file', 'search file',
  ];

  private static readonly CAN_HANDLE_PATTERNS: ReadonlyArray<RegExp> = [
    // All route patterns
    ...FileSearchPlugin.ROUTE_TABLE.map(([pattern]) => pattern),
  ];

  async canHandle(input: string, _context: PluginContext): Promise<boolean> {
    const lower = input.toLowerCase();
    return FileSearchPlugin.CAN_HANDLE_KEYWORDS.some(kw => lower.includes(kw)) ||
           FileSearchPlugin.CAN_HANDLE_PATTERNS.some(p => p.test(lower));
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();
    const lower = input.toLowerCase();

    try {
      // Route through the command table
      for (const [pattern, key] of FileSearchPlugin.ROUTE_TABLE) {
        if (!pattern.test(lower)) continue;

        switch (key) {
          case 'read':
            return await this.executeRead(input, context, start);
          case 'search':
            return await this.executeSearch(input, context, start);
        }
      }

      // Fallback: treat as search request
      return await this.executeSearch(input, context, start);
    } catch (err) {
      return this.errorResult(
        `Błąd wyszukiwania plików: ${err instanceof Error ? err.message : String(err)}`,
        start,
      );
    }
  }

  // isReadRequest method is no longer needed - handled by ROUTE_TABLE

  private async executeSearch(
    input: string,
    context: PluginContext,
    start: number,
  ): Promise<PluginResult> {
    const { query, searchPath, extensions } = this.parseSearchParams(input);
    
    if (!context.isTauri || !context.tauriInvoke) {
      return this.browserFallback(start, query, extensions);
    }

    const response = (await context.tauriInvoke('file_search', {
      query,
      searchPath: searchPath || undefined,
      extensions: extensions.length > 0 ? extensions : undefined,
      maxResults: 50,
      maxDepth: 8,
    })) as FileSearchResponse;

    if (response.total_found === 0) {
      return {
        pluginId: this.id,
        status: 'success',
        content: [
          {
            type: 'text',
            data: `🔍 Nie znaleziono plików pasujących do zapytania: **"${query}"**\n\n💡 Spróbuj:\n- Zmienić słowo kluczowe\n- Podać ścieżkę, np. \`znajdź pliki pdf w ~/Dokumenty\`\n- Szukać po rozszerzeniu, np. \`znajdź pliki .xlsx\``,
          },
        ],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    // >10 results: ask user to clarify
    if (response.total_found > 10) {
      return this.buildClarificationResult(response, query, start);
    }

    // ≤3 results: grid with thumbnails/previews
    if (response.total_found <= 3) {
      return this.buildGridResult(response, start);
    }

    // 4-10 results: list view
    return this.buildListResult(response, start);
  }

  private async executeRead(
    input: string,
    context: PluginContext,
    start: number,
  ): Promise<PluginResult> {
    if (!context.isTauri || !context.tauriInvoke) {
      return this.browserFallback(start);
    }

    const filePath = this.extractFilePath(input);
    if (!filePath) {
      return {
        pluginId: this.id,
        status: 'error',
        content: [
          {
            type: 'text',
            data: '❓ Nie podano ścieżki do pliku.\n\n💡 Przykład: `przeczytaj plik /home/user/dokument.txt`',
          },
        ],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    const response = (await context.tauriInvoke('file_read_content', {
      path: filePath,
      maxChars: 10000,
    })) as FileContentResponse;

    const isImage = response.mime_type.startsWith('image/');

    if (isImage && response.content.startsWith('data:')) {
      return {
        pluginId: this.id,
        status: 'success',
        content: [
          {
            type: 'text',
            data: `📄 **${response.name}** (${this.formatBytes(response.size_bytes)})`,
            title: response.name,
          },
          {
            type: 'image',
            data: response.content.split(',')[1] || response.content,
            mimeType: response.mime_type,
            title: response.name,
          },
        ],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    const truncNote = response.truncated
      ? '\n\n⚠️ *Plik jest dłuższy — pokazano pierwsze 10 000 znaków.*'
      : '';

    return {
      pluginId: this.id,
      status: 'success',
      content: [
        {
          type: 'text',
          data: `📄 **${response.name}** (${this.formatBytes(response.size_bytes)}, ${response.mime_type})\n\n\`\`\`\n${response.content}\n\`\`\`${truncNote}`,
          title: response.name,
        },
      ],
      metadata: { duration_ms: Date.now() - start, cached: false, truncated: response.truncated },
    };
  }

  private buildGridResult(response: FileSearchResponse, start: number): PluginResult {
    const blocks: Array<{ type: 'text' | 'image'; data: string; mimeType?: string }> = [];
    const actions: string[] = [];

    for (const file of response.results) {
      const sizeStr = this.formatBytes(file.size_bytes);
      const modStr = file.modified ? ` | ${file.modified}` : '';

      let fileInfo = `📁 **${file.name}**\n`;
      fileInfo += `📂 \`${file.path}\`\n`;
      fileInfo += `📊 ${file.file_type} | ${sizeStr}${modStr}\n`;

      if (file.preview) {
        fileInfo += `\n\`\`\`\n${file.preview.slice(0, 300)}\n\`\`\`\n`;
      }

      blocks.push({ type: 'text', data: fileInfo });
      
      // Build actions for ConfigPrompt
      actions.push(`Przeczytaj ${file.path}`);
      const dirPath = file.path.substring(0, file.path.lastIndexOf('/'));
      if (dirPath) actions.push(`Pokaż folder ${dirPath}`);
    }

    return {
      pluginId: this.id,
      status: 'success',
      content: blocks,
      metadata: { 
        duration_ms: Date.now() - start, 
        cached: false, 
        truncated: false,
      },
    };
  }

  private buildListResult(response: FileSearchResponse, start: number): PluginResult {
    const lines: string[] = [
      `🔍 Znaleziono **${response.total_found}** plików (${response.duration_ms}ms)\n`,
      '| Nazwa | Typ | Rozmiar | Zmieniony |',
      '|-------|-----|---------|-----------|',
    ];

    const actions: string[] = [];
    for (let i = 0; i < response.results.length; i++) {
      const f = response.results[i];
      lines.push(
        `| **${f.name}** | ${f.file_type} | ${this.formatBytes(f.size_bytes)} | ${f.modified || '—'} |`,
      );
      
      // Build actions for ConfigPrompt
      if (i < 5) {
        actions.push(`Przeczytaj ${f.path}`);
        const dirPath = f.path.substring(0, f.path.lastIndexOf('/'));
        if (dirPath) actions.push(`Pokaż folder ${dirPath}`);
      }
    }

    return {
      pluginId: this.id,
      status: 'success',
      content: [{ type: 'text', data: lines.join('\n') }],
      metadata: { 
        duration_ms: Date.now() - start, 
        cached: false, 
        truncated: false,
      },
    };
  }

  private buildClarificationResult(
    response: FileSearchResponse,
    query: string,
    start: number,
  ): PluginResult {
    const sample = response.results.slice(0, 5);
    const extCounts = new Map<string, number>();
    for (const f of response.results) {
      const ext = f.extension || 'brak';
      extCounts.set(ext, (extCounts.get(ext) || 0) + 1);
    }

    const extList = Array.from(extCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ext, count]) => `\`.${ext}\` (${count})`)
      .join(', ');

    const lines: string[] = [
      `🔍 Znaleziono **${response.total_found}** plików dla zapytania **"${query}"** — to dużo wyników.\n`,
      `📊 **Najczęstsze rozszerzenia:** ${extList}\n`,
      `📂 **Przykładowe pliki:**`,
    ];

    const actions: string[] = [];
    for (let i = 0; i < sample.length; i++) {
      lines.push(`${i + 1}. \`${sample[i].name}\` (${sample[i].file_type}, ${this.formatBytes(sample[i].size_bytes)})`);
      actions.push(`Przeczytaj ${sample[i].path}`);
    }

    lines.push(`\n❓ **Doprecyzuj zapytanie**, np.:`);
    actions.push(`Znajdź pliki pdf z ${query}`);
    actions.push(`Znajdź pliki ${query} w ~/Dokumenty`);
    actions.push(`Znajdź ostatnie pliki ${query}`);

    return {
      pluginId: this.id,
      status: 'partial',
      content: [{ type: 'text', data: lines.join('\n') }],
      metadata: {
        duration_ms: Date.now() - start,
        cached: false,
        truncated: true,
      },
    };
  }

  private parseSearchParams(input: string): {
    query: string;
    searchPath: string | null;
    extensions: string[];
  } {
    let query = input;
    let searchPath: string | null = null;
    const extensions: string[] = [];
    const ctx = getSystemContext();

    const looksLikeInvoiceQuery = /(faktur|faktura|fv\b|invoice|rachun)/i.test(input);

    // 1. Resolve semantic path references to actual system paths
    const semanticPaths: Array<{ pattern: RegExp; resolve: () => string }> = [
      { pattern: /(folder|katalog|pliki?)\s+(usera|u[żz]ytkownika|domowy|home)/i, resolve: () => ctx.homeDir },
      { pattern: /folder\s+domowy/i, resolve: () => ctx.homeDir },
      { pattern: /(na\s+)?pulpicie/i, resolve: () => `${ctx.homeDir}/${ctx.os === 'windows' ? 'Desktop' : 'Pulpit'}` },
      { pattern: /(w\s+)?dokumentach/i, resolve: () => `${ctx.homeDir}/${ctx.os === 'windows' ? 'Documents' : 'Dokumenty'}` },
      { pattern: /(w\s+)?pobranych/i, resolve: () => `${ctx.homeDir}/${ctx.os === 'windows' ? 'Downloads' : 'Pobrane'}` },
    ];

    for (const sp of semanticPaths) {
      const m = input.match(sp.pattern);
      if (m) {
        searchPath = sp.resolve();
        query = query.replace(m[0], '').trim();
        break;
      }
    }

    // 2. Extract explicit paths: "w ~/Documents", "w /home/user"
    if (!searchPath) {
      const pathPatterns = [
        /(?:w|z|na)\s+(\/\S+)/i,
        /(?:w|z|na)\s+(~\/\S+)/i,
        /(?:w\s+folderze|w\s+katalogu)\s+(\S+)/i,
        /(?:path|ścieżka|sciezka)\s+(\S+)/i,
      ];

      for (const pattern of pathPatterns) {
        const m = input.match(pattern);
        if (m) {
          searchPath = m[1];
          query = query.replace(m[0], '').trim();
          break;
        }
      }
    }

    // 3. Default to home dir for listing-type queries with no explicit path
    if (!searchPath && /lista|wylistuj|poka[zż]|co\s+(jest|mam)|zawarto|przejrzyj|wyświetl/i.test(input)) {
      searchPath = ctx.homeDir;
    }

    // 3b. For invoice-like queries, default to Documents when path is not specified
    if (!searchPath && looksLikeInvoiceQuery) {
      searchPath = `${ctx.homeDir}/${ctx.os === 'windows' ? 'Documents' : 'Dokumenty'}`;
    }

    // Extract extensions: ".pdf", "pdf", "pliki pdf"
    const extPatterns = [
      /\.(\w{2,5})\b/g,
      /(?:pliki?|dokumenty?|format)\s+(\w{2,5})\b/gi,
      /(?:rozszerzenie|ext)\s+(\w{2,5})\b/gi,
    ];

    for (const pattern of extPatterns) {
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(input)) !== null) {
        const ext = m[1].toLowerCase();
        if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv', 'json', 'xml', 'yaml', 'yml', 'html', 'py', 'ts', 'tsx', 'js', 'rs', 'go', 'java', 'c', 'cpp', 'jpg', 'jpeg', 'png', 'gif', 'svg', 'mp4', 'mp3', 'wav', 'zip', 'tar', 'sql', 'log', 'sh'].includes(ext)) {
          if (!extensions.includes(ext)) extensions.push(ext);
        }
      }
    }

    // Also detect standalone extension tokens like "pdf" (without ".pdf" or "pliki pdf")
    // Keep this conservative to avoid accidental matches (e.g. "go" as verb).
    if (extensions.length === 0) {
      const tokenExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png', 'csv', 'txt'];
      for (const ext of tokenExts) {
        const tokenRe = new RegExp(`\\b${ext}\\b`, 'i');
        if (tokenRe.test(input)) extensions.push(ext);
      }
    }

    // If user asked about invoices but didn't specify extension, narrow to common invoice formats
    if (looksLikeInvoiceQuery && extensions.length === 0) {
      extensions.push('pdf', 'jpg', 'jpeg', 'png', 'docx', 'xlsx');
    }

    // Clean up query — remove scope prefixes and command words
    query = query
      .replace(/^(local|public|tor|vpn|ssh)\$\s+/i, '') // Remove scope prefixes
      .replace(/znajd[źz]\s+plik[iy]?/gi, '')
      .replace(/wyszukaj\s+plik[iy]?/gi, '')
      .replace(/szukaj\s+plik[iy]?/gi, '')
      .replace(/znajd[źz]\s+dokument[yów]?/gi, '')
      .replace(/wyszukaj\s+dokument[yów]?/gi, '')
      .replace(/szukaj\s+dokument[yów]?/gi, '')
      .replace(/plik[iy]?\s+na\s+dysku/gi, '')
      .replace(/dokument[yów]?\s+na\s+dysku/gi, '')
      .replace(/find\s+file/gi, '')
      .replace(/search\s+file/gi, '')
      .replace(/file\s+search/gi, '')
      .replace(/lista\s+plik[óo]?w/gi, '')
      .replace(/wylistuj\s+plik[iy]?/gi, '')
      .replace(/poka[zż]\s+(mi\s+)?plik[iy]?/gi, '')
      .replace(/co\s+(jest|mam|znajduje\s+się)\s+(w|na)/gi, '')
      .replace(/zawartość/gi, '')
      .replace(/przejrzyj/gi, '')
      .replace(/wyświetl/gi, '')
      .trim();

    return { query, searchPath, extensions };
  }

  private extractFilePath(input: string): string | null {
    // Match absolute or relative paths
    const patterns = [
      /(\/[\w\-./]+\.\w+)/,
      /(~\/[\w\-./]+\.\w+)/,
      /plik[u]?\s+([\w\-./]+\.\w+)/i,
      /file\s+([\w\-./]+\.\w+)/i,
    ];

    for (const pattern of patterns) {
      const m = input.match(pattern);
      if (m) return m[1];
    }

    return null;
  }

  private browserFallback(start: number, query?: string, extensions?: string[]): PluginResult {
    const extHint = extensions && extensions.length > 0 ? ` (rozszerzenie: ${extensions.join(', ')})` : '';
    const actions: string[] = [];
    
    if (extensions && extensions.includes('pdf')) {
      actions.push('Wyszukaj faktury w Google Drive');
      actions.push('Pokaż ostatnie dokumenty PDF');
    }
    actions.push('Uruchom aplikację desktopową Broxeen');
    actions.push('Pomoc: jak wyszukiwać pliki');
    
    return {
      pluginId: this.id,
      status: 'partial',
      content: [
        {
          type: 'text',
          data: `🔍 **Wyszukiwanie plików${extHint}**\n\n⚠️ Wyszukiwanie lokalnych plików wymaga aplikacji desktopowej Broxeen (Tauri).\nW przeglądarce nie ma dostępu do systemu plików.\n\n💡 **Alternatywy:**\n- Uruchom Broxeen jako aplikację desktopową\n- Użyj wyszukiwarki plików systemowych\n- Sprawdź chmurę (Google Drive, Dropbox)`,
        },
      ],
      metadata: { 
        duration_ms: Date.now() - start, 
        cached: false, 
        truncated: false,
      },
    };
  }

  private formatBytes(bytes: number): string {
    if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
    if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
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
    console.log('FileSearchPlugin initialized');
  }

  async dispose(): Promise<void> {
    console.log('FileSearchPlugin disposed');
  }
}
