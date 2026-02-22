/**
 * Global Error Reporting System
 * Captures, logs and reports errors across the application
 */

import { logger } from '../lib/logger';

export interface ErrorReport {
  id: string;
  timestamp: number;
  type: 'javascript' | 'network' | 'plugin' | 'system' | 'user';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  stack?: string;
  context: {
    url: string;
    userAgent: string;
    userId?: string;
    sessionId: string;
    component?: string;
    action?: string;
  };
  details?: Record<string, any>;
  resolved: boolean;
}

class ErrorReporting {
  private errors: ErrorReport[] = [];
  private maxErrors = 100;
  private sessionId: string;
  private userId?: string;

  constructor() {
    this.sessionId = this.generateSessionId();
    this.setupGlobalHandlers();
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private setupGlobalHandlers() {
    // Handle unhandled JavaScript errors
    window.addEventListener('error', (event) => {
      this.captureError({
        type: 'javascript',
        severity: 'high',
        message: event.message,
        stack: event.error?.stack,
        context: this.getContext(),
        details: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        }
      });
    });

    // Handle unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      this.captureError({
        type: 'javascript',
        severity: 'high',
        message: `Unhandled promise rejection: ${event.reason}`,
        stack: event.reason?.stack,
        context: this.getContext(),
        details: {
          reason: event.reason,
          promise: event.promise,
        }
      });
    });

    // Handle resource loading errors
    window.addEventListener('error', (event) => {
      if (event.target !== window) {
        const target = event.target as HTMLElement;
        this.captureError({
          type: 'system',
          severity: 'medium',
          message: `Failed to load resource: ${target.tagName}`,
          context: this.getContext(),
          details: {
            tagName: target.tagName,
            src: (target as any).src,
            href: (target as any).href,
          }
        });
      }
    }, true);
  }

  private getContext() {
    return {
      url: window.location.href,
      userAgent: navigator.userAgent,
      userId: this.userId,
      sessionId: this.sessionId,
    };
  }

  captureError(error: Partial<ErrorReport>): string {
    const errorReport: ErrorReport = {
      id: this.generateErrorId(),
      timestamp: Date.now(),
      type: error.type || 'javascript',
      severity: error.severity || 'medium',
      message: error.message || 'Unknown error',
      stack: error.stack,
      context: {
        ...this.getContext(),
        ...error.context,
      },
      details: error.details,
      resolved: false,
    };

    // Log the error
    const scopedLogger = logger.scope('error-reporting');
    scopedLogger.error(`[${error.severity.toUpperCase()}] ${error.type}: ${error.message}`, {
      errorId: errorReport.id,
      stack: error.stack,
      context: errorReport.context,
      details: error.details,
    });

    // Store error (keep only recent errors)
    this.errors.push(errorReport);
    if (this.errors.length > this.maxErrors) {
      this.errors = this.errors.slice(-this.maxErrors);
    }

    // Show user notification for critical errors
    if (error.severity === 'critical') {
      this.showCriticalErrorNotification(errorReport);
    }

    return errorReport.id;
  }

  private generateErrorId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private showCriticalErrorNotification(error: ErrorReport) {
    const notification = document.createElement('div');
    notification.className = 'fixed top-4 right-4 bg-red-600 text-white px-4 py-3 rounded-lg shadow-lg z-50 max-w-md';
    notification.innerHTML = `
      <div class="flex items-start gap-3">
        <span class="text-xl">🚨</span>
        <div>
          <div class="font-semibold">Wystąpił krytyczny błąd</div>
          <div class="text-sm opacity-90 mt-1">${error.message}</div>
          <div class="text-xs opacity-75 mt-2">ID: ${error.id}</div>
        </div>
        <button onclick="this.parentElement.parentElement.remove()" class="ml-2 text-xl">&times;</button>
      </div>
    `;
    document.body.appendChild(notification);

    // Auto-remove after 10 seconds
    setTimeout(() => {
      if (notification.parentElement) {
        notification.remove();
      }
    }, 10000);
  }

  // Convenience methods for different error types
  captureNetworkError(message: string, details?: Record<string, any>) {
    return this.captureError({
      type: 'network',
      severity: 'medium',
      message,
      details,
    });
  }

  capturePluginError(pluginId: string, message: string, details?: Record<string, any>) {
    return this.captureError({
      type: 'plugin',
      severity: 'high',
      message: `Plugin ${pluginId}: ${message}`,
      context: { component: 'plugin', action: pluginId },
      details: { pluginId, ...details },
    });
  }

  captureUserError(message: string, details?: Record<string, any>) {
    return this.captureError({
      type: 'user',
      severity: 'low',
      message,
      details,
    });
  }

  captureSystemError(message: string, details?: Record<string, any>) {
    return this.captureError({
      type: 'system',
      severity: 'high',
      message,
      details,
    });
  }

  // Get error statistics
  getErrorStats() {
    const stats = {
      total: this.errors.length,
      byType: {} as Record<string, number>,
      bySeverity: {} as Record<string, number>,
      recent: this.errors.slice(-10),
      unresolved: this.errors.filter(e => !e.resolved).length,
    };

    this.errors.forEach(error => {
      stats.byType[error.type] = (stats.byType[error.type] || 0) + 1;
      stats.bySeverity[error.severity] = (stats.bySeverity[error.severity] || 0) + 1;
    });

    return stats;
  }

  // Get errors for reporting
  getErrors(options: {
    type?: string;
    severity?: string;
    limit?: number;
    unresolved?: boolean;
  } = {}) {
    let filtered = [...this.errors];

    if (options.type) {
      filtered = filtered.filter(e => e.type === options.type);
    }
    if (options.severity) {
      filtered = filtered.filter(e => e.severity === options.severity);
    }
    if (options.unresolved) {
      filtered = filtered.filter(e => !e.resolved);
    }
    if (options.limit) {
      filtered = filtered.slice(-options.limit);
    }

    return filtered;
  }

  // Mark error as resolved
  resolveError(errorId: string) {
    const error = this.errors.find(e => e.id === errorId);
    if (error) {
      error.resolved = true;
      logger.scope('error-reporting').info(`Error resolved: ${errorId}`);
    }
  }

  // Clear all errors
  clearErrors() {
    this.errors = [];
    logger.scope('error-reporting').info('All errors cleared');
  }

  // Export errors for debugging
  exportErrors(): string {
    const stats = this.getErrorStats();
    const errors = this.getErrors({ limit: 50 });

    let report = `🚨 BROXEEN ERROR REPORT - ${new Date().toLocaleString('pl-PL')}\n`;
    report += `Session: ${this.sessionId}\n`;
    report += `Total Errors: ${stats.total}\n`;
    report += `Unresolved: ${stats.unresolved}\n\n`;

    report += `📊 Statistics:\n`;
    Object.entries(stats.byType).forEach(([type, count]) => {
      report += `  ${type}: ${count}\n`;
    });
    report += '\n';

    Object.entries(stats.bySeverity).forEach(([severity, count]) => {
      report += `  ${severity}: ${count}\n`;
    });
    report += '\n';

    report += `📋 Recent Errors (last 50):\n`;
    errors.forEach((error, index) => {
      report += `${index + 1}. [${error.severity.toUpperCase()}] ${error.type}: ${error.message}\n`;
      report += `   ID: ${error.id}\n`;
      report += `   Time: ${new Date(error.timestamp).toLocaleString('pl-PL')}\n`;
      if (error.context.component) {
        report += `   Component: ${error.context.component}\n`;
      }
      if (error.details) {
        report += `   Details: ${JSON.stringify(error.details, null, 2)}\n`;
      }
      report += '\n';
    });

    return report;
  }
}

// Global instance
export const errorReporting = new ErrorReporting();

// Convenience exports
export const captureError = (error: Partial<ErrorReport>) => errorReporting.captureError(error);
export const captureNetworkError = (message: string, details?: Record<string, any>) => 
  errorReporting.captureNetworkError(message, details);
export const capturePluginError = (pluginId: string, message: string, details?: Record<string, any>) => 
  errorReporting.capturePluginError(pluginId, message, details);
export const captureUserError = (message: string, details?: Record<string, any>) => 
  errorReporting.captureUserError(message, details);
export const captureSystemError = (message: string, details?: Record<string, any>) => 
  errorReporting.captureSystemError(message, details);
