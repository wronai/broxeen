/**
 * Device Status Plugin - provides device status monitoring and reporting
 * Shows online/offline status and last activity for discovered devices
 */

import type { Plugin, PluginContext, PluginResult } from '../../core/types';
import { DeviceRepository } from '../../persistence/deviceRepository';
import { logger } from '../../lib/logger';

const statusLogger = logger.scope('device-status');

export class DeviceStatusPlugin implements Plugin {
  readonly id = 'device-status';
  readonly name = 'Device Status Monitor';
  readonly version = '1.0.0';
  readonly supportedIntents = ['device:status', 'device:online', 'device:offline', 'device:activity'];

  private deviceRepo?: DeviceRepository;

  async initialize(context: PluginContext): Promise<void> {
    try {
      if (!context.databaseManager) {
        statusLogger.warn('DatabaseManager not available in context');
        return;
      }
      
      this.deviceRepo = new DeviceRepository(context.databaseManager.getDevicesDb());
      statusLogger.info('DeviceStatusPlugin initialized');
    } catch (err) {
      statusLogger.warn('Failed to initialize DeviceStatusPlugin', err);
    }
  }

  async canHandle(input: string, context: PluginContext): Promise<boolean> {
    const lowerInput = input.toLowerCase();
    const statusKeywords = [
      'status urządzeń', 'status urządzenia', 'statusy', 'status',
      'urządzenia online', 'urządzenia offline', 'urządzenia aktywne',
      'device status', 'device online', 'device offline', 'active devices',
      'ostatnia aktywność', 'last activity', 'last seen'
    ];
    
    return statusKeywords.some(keyword => lowerInput.includes(keyword));
  }

  async execute(input: string, context: PluginContext): Promise<PluginResult> {
    const start = Date.now();
    
    if (!this.deviceRepo) {
      return {
        pluginId: this.id,
        status: 'error',
        content: [{ type: 'text', data: '❌ Baza danych urządzeń nie jest dostępna.' }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }

    const lowerInput = input.toLowerCase();
    
    // Check what kind of status request this is
    if (lowerInput.includes('online') || lowerInput.includes('aktywne')) {
      return await this.showOnlineDevices();
    } else if (lowerInput.includes('offline')) {
      return await this.showOfflineDevices();
    } else if (lowerInput.includes('ostatnia') || lowerInput.includes('last')) {
      return await this.showRecentActivity();
    } else {
      // General status overview
      return await this.showGeneralStatus();
    }
  }

  private async showGeneralStatus(): Promise<PluginResult> {
    const start = Date.now();
    
    try {
      const devicesWithStatus = await this.deviceRepo!.getDevicesWithStatus();
      const recentlyActive = await this.deviceRepo!.getRecentlyActiveDevices(30);
      const offlineDevices = await this.deviceRepo!.getOfflineDevices(2);
      
      const totalDevices = devicesWithStatus.length;
      const onlineCount = recentlyActive.length;
      const offlineCount = offlineDevices.length;
      const unknownCount = totalDevices - onlineCount - offlineCount;

      let content = `## 📊 Status Urządzeń w Sieci\n\n`;
      content += `**Podsumowanie:**\n`;
      content += `- 🟢 **Online (aktywne):** ${onlineCount} urządzeń\n`;
      content += `- 🔴 **Offline:** ${offlineCount} urządzeń\n`;
      content += `- ⚪ **Nieznany status:** ${unknownCount} urządzeń\n`;
      content += `- 📈 **Łącznie:** ${totalDevices} urządzeń\n\n`;

      if (recentlyActive.length > 0) {
        content += `### 🟢 Niedawno Aktywne (ostatnie 30 min)\n\n`;
        recentlyActive.slice(0, 5).forEach(device => {
          const minutesAgo = Math.round(device.minutes_since_last_seen);
          content += `- **${device.ip}**${device.hostname ? ` (${device.hostname})` : ''} — ${minutesAgo} min temu\n`;
        });
        
        if (recentlyActive.length > 5) {
          content += `- ... i ${recentlyActive.length - 5} więcej\n`;
        }
        content += '\n';
      }

      if (offlineDevices.length > 0) {
        content += `### 🔴 Urządzenia Offline (brak aktywności > 2h)\n\n`;
        offlineDevices.slice(0, 3).forEach(device => {
          const hoursAgo = Math.round(device.hours_since_last_seen);
          content += `- **${device.ip}**${device.hostname ? ` (${device.hostname})` : ''} — ${hoursAgo}h temu\n`;
        });
        
        if (offlineDevices.length > 3) {
          content += `- ... i ${offlineDevices.length - 3} więcej\n`;
        }
        content += '\n';
      }

      content += `### 📋 Dostępne komendy\n\n`;
      content += `- \`status online\` — pokaż tylko aktywne urządzenia\n`;
      content += `- \`status offline\` — pokaż tylko urządzenia offline\n`;
      content += `- \`ostatnia aktywność\` — pokaż historię aktywności\n`;

      return {
        pluginId: this.id,
        status: 'success',
        content: [{ type: 'text', data: content }],
        metadata: {
          duration_ms: Date.now() - start,
          cached: false,
          truncated: false,
          total_devices: totalDevices,
          online_count: onlineCount,
          offline_count: offlineCount,
        } as any,
      };
    } catch (err) {
      statusLogger.error('Failed to get general status', err);
      return {
        pluginId: this.id,
        status: 'error',
        content: [{ type: 'text', data: '❌ Nie udało się pobrać statusu urządzeń.' }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }
  }

  private async showOnlineDevices(): Promise<PluginResult> {
    const start = Date.now();
    
    try {
      const recentlyActive = await this.deviceRepo!.getRecentlyActiveDevices(60); // Last hour
      
      if (recentlyActive.length === 0) {
        return {
          pluginId: this.id,
          status: 'success',
          content: [{ type: 'text', data: '🔍 Brak aktywnych urządzeń w ostatniej godzinie.' }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
        };
      }

      let content = `## 🟢 Aktywne Urządzenia (ostatnia godzina)\n\n`;
      
      recentlyActive.forEach(device => {
        const minutesAgo = Math.round(device.minutes_since_last_seen);
        content += `- **${device.ip}**${device.hostname ? ` (${device.hostname})` : ''}\n`;
        content += `  ⏱️ ${minutesAgo} minut temu\n`;
      });

      content += `\n📊 **Podsumowanie:** ${recentlyActive.length} aktywnych urządzeń`;

      return {
        pluginId: this.id,
        status: 'success',
        content: [{ type: 'text', data: content }],
        metadata: {
          duration_ms: Date.now() - start,
          cached: false,
          truncated: false,
          active_count: recentlyActive.length,
        } as any,
      };
    } catch (err) {
      statusLogger.error('Failed to get online devices', err);
      return {
        pluginId: this.id,
        status: 'error',
        content: [{ type: 'text', data: '❌ Nie udało się pobrać listy aktywnych urządzeń.' }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }
  }

  private async showOfflineDevices(): Promise<PluginResult> {
    const start = Date.now();
    
    try {
      const offlineDevices = await this.deviceRepo!.getOfflineDevices(1); // Last hour
      
      if (offlineDevices.length === 0) {
        return {
          pluginId: this.id,
          status: 'success',
          content: [{ type: 'text', data: '✅ Wszystkie znane urządzenia były aktywne w ostatniej godzinie.' }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
        };
      }

      let content = `## 🔴 Urządzenia Offline (brak aktywności > 1h)\n\n`;
      
      offlineDevices.forEach(device => {
        const hoursAgo = Math.round(device.hours_since_last_seen);
        content += `- **${device.ip}**${device.hostname ? ` (${device.hostname})` : ''}\n`;
        content += `  ⏱️ ${hoursAgo} godzin temu\n`;
      });

      content += `\n⚠️ **Podsumowanie:** ${offlineDevices.length} urządzeń offline`;

      return {
        pluginId: this.id,
        status: 'success',
        content: [{ type: 'text', data: content }],
        metadata: {
          duration_ms: Date.now() - start,
          cached: false,
          truncated: false,
          offline_count: offlineDevices.length,
        } as any,
      };
    } catch (err) {
      statusLogger.error('Failed to get offline devices', err);
      return {
        pluginId: this.id,
        status: 'error',
        content: [{ type: 'text', data: '❌ Nie udało się pobrać listy urządzeń offline.' }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }
  }

  private async showRecentActivity(): Promise<PluginResult> {
    const start = Date.now();
    
    try {
      const devicesWithStatus = await this.deviceRepo!.getDevicesWithStatus();
      
      if (devicesWithStatus.length === 0) {
        return {
          pluginId: this.id,
          status: 'success',
          content: [{ type: 'text', data: '📭 Brak znanych urządzeń w bazie.' }],
          metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
        };
      }

      let content = `## 🕐 Ostatnia Aktywność Urządzeń\n\n`;
      
      devicesWithStatus.slice(0, 10).forEach(device => {
        const lastSeen = new Date(device.last_seen);
        const timeAgo = this.formatTimeAgo(lastSeen);
        const statusIcon = this.getStatusIcon(device.status, device.last_seen);
        
        content += `${statusIcon} **${device.ip}**${device.hostname ? ` (${device.hostname})` : ''}\n`;
        content += `   ⏱️ ${timeAgo}\n`;
        content += `   🔌 ${device.services_count} usług\n\n`;
      });

      if (devicesWithStatus.length > 10) {
        content += `... i ${devicesWithStatus.length - 10} więcej urządzeń\n\n`;
      }

      return {
        pluginId: this.id,
        status: 'success',
        content: [{ type: 'text', data: content, title: 'Ostatnia aktywność' }],
        metadata: {
          duration_ms: Date.now() - start,
          cached: false,
          truncated: false,
          deviceCount: Math.min(10, devicesWithStatus.length),
        },
      };
    } catch (err) {
      statusLogger.error('Failed to get recent activity', err);
      return {
        pluginId: this.id,
        status: 'error',
        content: [{ type: 'text', data: '❌ Nie udało się pobrać historii aktywności.' }],
        metadata: { duration_ms: Date.now() - start, cached: false, truncated: false },
      };
    }
  }

  private formatTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'przed chwilą';
    if (diffMins < 60) return `${diffMins} minut temu`;
    if (diffHours < 24) return `${diffHours} godzin temu`;
    return `${diffDays} dni temu`;
  }

  private getStatusIcon(status: string, lastSeen: number): string {
    const now = Date.now();
    const minutesAgo = (now - lastSeen) / 60000;
    
    if (minutesAgo < 5) return '🟢';
    if (minutesAgo < 60) return '🟡';
    if (minutesAgo < 360) return '🟠';
    return '🔴';
  }
}
