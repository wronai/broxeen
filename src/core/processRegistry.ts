export type ProcessStatus = 'running' | 'completed' | 'failed' | 'stopped';

export type ProcessType =
  | 'monitor'
  | 'query'
  | 'search'
  | 'scan'
  | 'other';

export interface ProcessInfo {
  readonly id: string;
  readonly type: ProcessType;
  readonly label: string;
  readonly status: ProcessStatus;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly pluginId?: string;
  readonly details?: string;
  readonly stopCommand?: string;
}

type ProcessRecord = {
  id: string;
  type: ProcessType;
  label: string;
  status: ProcessStatus;
  startedAt: number;
  updatedAt: number;
  pluginId?: string;
  details?: string;
  stopCommand?: string;
};

export class ProcessRegistry {
  private processes = new Map<string, ProcessRecord>();

  upsertRunning(process: {
    id: string;
    type: ProcessType;
    label: string;
    pluginId?: string;
    details?: string;
    stopCommand?: string;
  }): void {
    const now = Date.now();
    const existing = this.processes.get(process.id);
    if (existing) {
      this.processes.set(process.id, {
        ...existing,
        ...process,
        status: 'running',
        updatedAt: now,
      });
      return;
    }

    this.processes.set(process.id, {
      id: process.id,
      type: process.type,
      label: process.label,
      status: 'running',
      startedAt: now,
      updatedAt: now,
      pluginId: process.pluginId,
      details: process.details,
      stopCommand: process.stopCommand,
    });
  }

  complete(id: string): void {
    this.setStatus(id, 'completed');
  }

  fail(id: string, details?: string): void {
    this.setStatus(id, 'failed', details);
  }

  stop(id: string): void {
    this.setStatus(id, 'stopped');
  }

  remove(id: string): void {
    this.processes.delete(id);
  }

  clear(): void {
    this.processes.clear();
  }

  listActive(): ProcessInfo[] {
    return this.listAll().filter((p) => p.status === 'running');
  }

  listAll(): ProcessInfo[] {
    return Array.from(this.processes.values())
      .map((p) => ({ ...p } as ProcessInfo))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): ProcessInfo | null {
    const p = this.processes.get(id);
    return p ? ({ ...p } as ProcessInfo) : null;
  }

  private setStatus(id: string, status: ProcessStatus, details?: string): void {
    const now = Date.now();
    const existing = this.processes.get(id);
    if (!existing) return;
    this.processes.set(id, {
      ...existing,
      status,
      updatedAt: now,
      details: details ?? existing.details,
    });
  }
}

export const processRegistry = new ProcessRegistry();
