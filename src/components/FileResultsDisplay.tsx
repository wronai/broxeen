/**
 * FileResultsDisplay — Renders file search results in chat with adaptive layout:
 * - ≤3 files: Grid with thumbnails/previews
 * - 4-10 files: Compact clickable list
 * - >10 files: Clarification prompt asking user to narrow search
 *
 * Supports click-to-read, click-to-send-email actions.
 */

import { useState } from 'react';
import {
  FileText, Image, Film, Music, Archive, Code, Table,
  FileSpreadsheet, Presentation, File, FolderOpen,
  Eye, Mail, Download, ChevronDown, ChevronUp,
} from 'lucide-react';

export interface FileResult {
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

interface FileResultsDisplayProps {
  files: FileResult[];
  query: string;
  totalFound: number;
  durationMs: number;
  truncated: boolean;
  onReadFile: (path: string) => void;
  onSendEmail: (paths: string[]) => void;
  onClarify: (query: string) => void;
  className?: string;
}

function getFileIcon(ext: string, mime: string) {
  const lower = ext.toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp'].includes(lower)) return <Image size={16} className="text-green-400" />;
  if (['mp4', 'webm', 'avi', 'mkv', 'mov'].includes(lower)) return <Film size={16} className="text-purple-400" />;
  if (['mp3', 'wav', 'ogg', 'flac', 'aac'].includes(lower)) return <Music size={16} className="text-pink-400" />;
  if (['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar'].includes(lower)) return <Archive size={16} className="text-amber-400" />;
  if (['rs', 'ts', 'tsx', 'js', 'jsx', 'py', 'rb', 'go', 'java', 'c', 'cpp', 'h', 'cs', 'swift', 'kt', 'sh'].includes(lower)) return <Code size={16} className="text-cyan-400" />;
  if (['csv', 'tsv'].includes(lower)) return <Table size={16} className="text-emerald-400" />;
  if (['xls', 'xlsx'].includes(lower)) return <FileSpreadsheet size={16} className="text-green-500" />;
  if (['ppt', 'pptx'].includes(lower)) return <Presentation size={16} className="text-orange-400" />;
  if (['pdf', 'doc', 'docx', 'txt', 'md', 'html'].includes(lower)) return <FileText size={16} className="text-blue-400" />;
  return <File size={16} className="text-gray-400" />;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function FileResultsDisplay({
  files,
  query,
  totalFound,
  durationMs,
  truncated,
  onReadFile,
  onSendEmail,
  onClarify,
  className = '',
}: FileResultsDisplayProps) {
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  const toggleSelect = (path: string) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const handleSendSelected = () => {
    if (selectedFiles.size > 0) {
      onSendEmail(Array.from(selectedFiles));
    }
  };

  // >10 files: Clarification mode
  if (totalFound > 10) {
    return (
      <ClarificationView
        files={files}
        query={query}
        totalFound={totalFound}
        durationMs={durationMs}
        onClarify={onClarify}
        className={className}
      />
    );
  }

  // ≤3 files: Grid with thumbnails
  if (files.length <= 3) {
    return (
      <div className={`space-y-3 ${className}`} data-testid="file-results-grid">
        <div className="text-xs text-gray-400 mb-2">
          🔍 Znaleziono {totalFound} plik{totalFound === 1 ? '' : totalFound <= 4 ? 'i' : 'ów'} ({durationMs}ms)
        </div>

        <div className={`grid gap-3 ${files.length === 1 ? 'grid-cols-1' : files.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
          {files.map(file => (
            <div
              key={file.path}
              className="group relative rounded-xl border border-gray-700 bg-gray-800/60 p-3 hover:border-broxeen-500/50 transition-all cursor-pointer"
              onClick={() => onReadFile(file.path)}
            >
              {/* Thumbnail / Preview area */}
              <div className="h-24 rounded-lg bg-gray-900/50 flex items-center justify-center mb-2 overflow-hidden">
                {file.mime_type.startsWith('image/') ? (
                  <div className="text-3xl opacity-60">🖼️</div>
                ) : file.preview ? (
                  <pre className="text-[9px] text-gray-500 leading-tight p-1.5 overflow-hidden max-h-full w-full">
                    {file.preview.slice(0, 200)}
                  </pre>
                ) : (
                  <div className="flex flex-col items-center gap-1">
                    {getFileIcon(file.extension, file.mime_type)}
                    <span className="text-[10px] text-gray-500 uppercase">{file.extension || '—'}</span>
                  </div>
                )}
              </div>

              {/* File info */}
              <div className="truncate text-xs font-medium text-gray-200 group-hover:text-white" title={file.name}>
                {file.name}
              </div>
              <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-500">
                <span>{file.file_type}</span>
                <span>•</span>
                <span>{formatBytes(file.size_bytes)}</span>
              </div>
              {file.modified && (
                <div className="text-[10px] text-gray-600 mt-0.5 truncate">{file.modified}</div>
              )}

              {/* Hover actions */}
              <div className="absolute top-2 right-2 hidden group-hover:flex gap-1">
                <button
                  onClick={(e) => { e.stopPropagation(); onReadFile(file.path); }}
                  className="p-1 rounded bg-gray-700/80 text-gray-300 hover:text-white hover:bg-gray-600"
                  title="Odczytaj"
                >
                  <Eye size={12} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onSendEmail([file.path]); }}
                  className="p-1 rounded bg-gray-700/80 text-gray-300 hover:text-white hover:bg-gray-600"
                  title="Wyślij email"
                >
                  <Mail size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 4-10 files: Compact list
  return (
    <div className={`space-y-2 ${className}`} data-testid="file-results-list">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-gray-400">
          🔍 Znaleziono {totalFound} plików ({durationMs}ms)
        </span>
        {selectedFiles.size > 0 && (
          <button
            onClick={handleSendSelected}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-broxeen-600/20 text-broxeen-400 border border-broxeen-600/30 hover:bg-broxeen-600/30 transition"
          >
            <Mail size={11} />
            Wyślij {selectedFiles.size} plik{selectedFiles.size > 1 ? (selectedFiles.size <= 4 ? 'i' : 'ów') : ''}
          </button>
        )}
      </div>

      {files.map(file => (
        <div key={file.path} className="group">
          <div
            className="flex items-center gap-3 rounded-lg border border-gray-700/50 bg-gray-800/40 px-3 py-2 hover:border-gray-600 hover:bg-gray-800/60 transition cursor-pointer"
            onClick={() => onReadFile(file.path)}
          >
            {/* Checkbox */}
            <input
              type="checkbox"
              checked={selectedFiles.has(file.path)}
              onChange={(e) => { e.stopPropagation(); toggleSelect(file.path); }}
              onClick={(e) => e.stopPropagation()}
              className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-700 text-broxeen-500 focus:ring-broxeen-500 cursor-pointer"
            />

            {/* Icon */}
            {getFileIcon(file.extension, file.mime_type)}

            {/* Name & info */}
            <div className="flex-1 min-w-0">
              <div className="truncate text-xs font-medium text-gray-200 group-hover:text-white">
                {file.name}
              </div>
              <div className="truncate text-[10px] text-gray-500">
                {file.path}
              </div>
            </div>

            {/* Meta */}
            <div className="flex items-center gap-3 text-[10px] text-gray-500 flex-shrink-0">
              <span>{formatBytes(file.size_bytes)}</span>
              {file.modified && <span>{file.modified.split(' ')[0]}</span>}
            </div>

            {/* Expand toggle */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpandedFile(expandedFile === file.path ? null : file.path);
              }}
              className="p-1 text-gray-500 hover:text-gray-300"
            >
              {expandedFile === file.path ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          </div>

          {/* Expanded preview */}
          {expandedFile === file.path && file.preview && (
            <div className="ml-10 mt-1 rounded-lg border border-gray-700/30 bg-gray-900/40 p-2">
              <pre className="text-[10px] text-gray-400 leading-tight overflow-x-auto max-h-32">
                {file.preview}
              </pre>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => onReadFile(file.path)}
                  className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-gray-700 text-gray-300 hover:text-white hover:bg-gray-600"
                >
                  <Eye size={10} /> Czytaj więcej
                </button>
                <button
                  onClick={() => onSendEmail([file.path])}
                  className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-gray-700 text-gray-300 hover:text-white hover:bg-gray-600"
                >
                  <Mail size={10} /> Wyślij
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Clarification subcomponent (>10 results) ────────────────

function ClarificationView({
  files,
  query,
  totalFound,
  durationMs,
  onClarify,
  className,
}: {
  files: FileResult[];
  query: string;
  totalFound: number;
  durationMs: number;
  onClarify: (q: string) => void;
  className?: string;
}) {
  // Compute extension distribution
  const extCounts = new Map<string, number>();
  for (const f of files) {
    const ext = f.extension || 'brak';
    extCounts.set(ext, (extCounts.get(ext) || 0) + 1);
  }
  const topExts = Array.from(extCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  return (
    <div className={`space-y-3 ${className}`} data-testid="file-results-clarification">
      <div className="text-xs text-gray-400">
        🔍 Znaleziono <strong className="text-white">{totalFound}</strong> plików ({durationMs}ms) — to dużo wyników.
      </div>

      <div className="text-sm text-gray-300">
        ❓ <strong>Doprecyzuj zapytanie</strong> — o jakie pliki Ci chodzi?
      </div>

      {/* Extension filter pills */}
      <div className="flex flex-wrap gap-2">
        {topExts.map(([ext, count]) => (
          <button
            key={ext}
            onClick={() => onClarify(`znajdź pliki .${ext} ${query}`)}
            className="flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800/50 px-3 py-1.5 text-xs text-gray-300 hover:border-broxeen-500/50 hover:text-white transition"
          >
            {getFileIcon(ext, '')}
            <span>.{ext}</span>
            <span className="text-gray-500">({count})</span>
          </button>
        ))}
      </div>

      {/* Sample files */}
      <div className="text-[11px] text-gray-500">
        Przykładowe pliki:
      </div>
      <div className="space-y-1">
        {files.slice(0, 5).map((f, i) => (
          <div key={f.path} className="flex items-center gap-2 text-[11px] text-gray-400">
            <span className="text-gray-600">{i + 1}.</span>
            {getFileIcon(f.extension, f.mime_type)}
            <span className="truncate">{f.name}</span>
            <span className="text-gray-600 flex-shrink-0">{formatBytes(f.size_bytes)}</span>
          </div>
        ))}
      </div>

      {/* Suggested refinements */}
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          onClick={() => onClarify(`znajdź pliki ${query} w ~/Dokumenty`)}
          className="text-[11px] px-2.5 py-1 rounded-lg bg-broxeen-600/10 text-broxeen-400 border border-broxeen-600/20 hover:bg-broxeen-600/20 transition"
        >
          📂 Tylko w Dokumenty
        </button>
        <button
          onClick={() => onClarify(`znajdź ostatnie pliki ${query}`)}
          className="text-[11px] px-2.5 py-1 rounded-lg bg-broxeen-600/10 text-broxeen-400 border border-broxeen-600/20 hover:bg-broxeen-600/20 transition"
        >
          🕐 Najnowsze
        </button>
        <button
          onClick={() => onClarify(`znajdź pliki pdf ${query}`)}
          className="text-[11px] px-2.5 py-1 rounded-lg bg-broxeen-600/10 text-broxeen-400 border border-broxeen-600/20 hover:bg-broxeen-600/20 transition"
        >
          📄 Tylko PDF
        </button>
      </div>
    </div>
  );
}
