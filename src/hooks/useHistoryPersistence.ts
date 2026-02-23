/**
 * useHistoryPersistence — provides command and network history
 * persistence via SQLite, with localStorage fallback.
 *
 * Replaces direct localStorage calls in Chat.tsx.
 */

import { useRef, useCallback } from 'react';
import { HistoryRepository } from '../persistence/historyRepository';
import type { DatabaseManager } from '../persistence/databaseManager';
import { logger } from '../lib/logger';

const histLogger = logger.scope('persistence:historyHook');

export interface CommandHistoryItem {
  id: string;
  command: string;
  timestamp: number;
  result?: string;
  category: 'network' | 'camera' | 'browse' | 'chat' | 'other';
  success: boolean;
}

export interface NetworkHistoryItem {
  id: string;
  address: string;
  name: string;
  scope: string;
  description?: string;
  lastUsed: number;
  usageCount: number;
}

export function useHistoryPersistence(databaseManager: DatabaseManager | null) {
  const repoRef = useRef<HistoryRepository | null>(null);

  const getRepo = useCallback((): HistoryRepository | null => {
    if (repoRef.current) return repoRef.current;
    if (!databaseManager || !databaseManager.isReady()) return null;

    try {
      repoRef.current = new HistoryRepository(databaseManager.getChatDb());
      return repoRef.current;
    } catch {
      return null;
    }
  }, [databaseManager]);

  // ── Command History ──────────────────────────────────────────

  const addToCommandHistory = useCallback(
    (command: string, result?: string, category: CommandHistoryItem['category'] = 'other', success = true) => {
      const repo = getRepo();
      if (repo) {
        repo.upsertCommand(command.trim(), result, category, success).catch((err) => {
          histLogger.warn('upsertCommand failed, falling back to localStorage', err);
          addToCommandHistoryLocalStorage(command, result, category, success);
        });
      } else {
        addToCommandHistoryLocalStorage(command, result, category, success);
      }
    },
    [getRepo],
  );

  const loadCommandHistory = useCallback(
    async (limit = 50): Promise<CommandHistoryItem[]> => {
      const repo = getRepo();
      if (repo) {
        try {
          const rows = await repo.listCommands(limit);
          return rows.map((r) => ({
            id: r.id,
            command: r.command,
            timestamp: r.timestamp,
            result: r.result ?? undefined,
            category: r.category as CommandHistoryItem['category'],
            success: r.success,
          }));
        } catch {
          // fall through to localStorage
        }
      }
      return loadCommandHistoryLocalStorage();
    },
    [getRepo],
  );

  // ── Network History ──────────────────────────────────────────

  const addToNetworkHistory = useCallback(
    (scope: string, name: string, address: string) => {
      const description = `${scope === 'local' ? 'Sieć lokalna' : scope === 'global' ? 'Internet globalny' : scope === 'tor' ? 'Sieć Tor' : scope === 'vpn' ? 'VPN' : 'Custom'} - ${address}`;

      const repo = getRepo();
      if (repo) {
        repo.saveNetworkEntry({ address, name, scope, description }).catch((err) => {
          histLogger.warn('saveNetworkEntry failed, falling back to localStorage', err);
          addToNetworkHistoryLocalStorage(scope, name, address, description);
        });
      } else {
        addToNetworkHistoryLocalStorage(scope, name, address, description);
      }
    },
    [getRepo],
  );

  const loadNetworkHistory = useCallback(
    async (limit = 10): Promise<NetworkHistoryItem[]> => {
      const repo = getRepo();
      if (repo) {
        try {
          const rows = await repo.listNetworkHistory(limit);
          return rows.map((r) => ({
            id: r.id,
            address: r.address,
            name: r.name,
            scope: r.scope,
            description: r.description ?? undefined,
            lastUsed: r.last_used,
            usageCount: r.usage_count,
          }));
        } catch {
          // fall through to localStorage
        }
      }
      return loadNetworkHistoryLocalStorage();
    },
    [getRepo],
  );

  return {
    addToCommandHistory,
    loadCommandHistory,
    addToNetworkHistory,
    loadNetworkHistory,
  };
}

// ── localStorage fallbacks (backward-compatible) ──────────────

function addToCommandHistoryLocalStorage(command: string, result?: string, category = 'other', success = true) {
  try {
    const historyKey = 'broxeen_command_history';
    const saved = localStorage.getItem(historyKey);
    let history: CommandHistoryItem[] = saved ? JSON.parse(saved) : [];

    const newItem: CommandHistoryItem = {
      id: Date.now().toString(),
      command: command.trim(),
      timestamp: Date.now(),
      result,
      category: category as CommandHistoryItem['category'],
      success,
    };

    const existingIndex = history.findIndex((item) => item.command === newItem.command);
    if (existingIndex >= 0) {
      history[existingIndex] = { ...history[existingIndex], timestamp: Date.now(), result, category: category as any, success };
    } else {
      history.unshift(newItem);
    }

    history = history.slice(0, 50);
    localStorage.setItem(historyKey, JSON.stringify(history));
  } catch {
    // ignore
  }
}

function loadCommandHistoryLocalStorage(): CommandHistoryItem[] {
  try {
    const saved = localStorage.getItem('broxeen_command_history');
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function addToNetworkHistoryLocalStorage(scope: string, name: string, address: string, description: string) {
  try {
    const historyKey = 'broxeen_network_history';
    const saved = localStorage.getItem(historyKey);
    let history: NetworkHistoryItem[] = saved ? JSON.parse(saved) : [];

    const existingIndex = history.findIndex((item) => item.address === address);
    if (existingIndex >= 0) {
      history[existingIndex] = {
        ...history[existingIndex],
        lastUsed: Date.now(),
        usageCount: history[existingIndex].usageCount + 1,
      };
    } else {
      history.unshift({
        id: Date.now().toString(),
        address,
        name,
        scope,
        description,
        lastUsed: Date.now(),
        usageCount: 1,
      });
    }

    history = history.slice(0, 10);
    localStorage.setItem(historyKey, JSON.stringify(history));
  } catch {
    // ignore
  }
}

function loadNetworkHistoryLocalStorage(): NetworkHistoryItem[] {
  try {
    const saved = localStorage.getItem('broxeen_network_history');
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}
