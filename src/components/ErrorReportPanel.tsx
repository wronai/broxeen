/**
 * Error Report Panel - Displays and manages error reports
 */

import React, { useState, useEffect } from 'react';
import { errorReporting } from '../utils/errorReporting';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: Record<string, unknown>;
  }
}

interface ErrorReportPanelProps {
  isVisible: boolean;
  onClose: () => void;
}

export const ErrorReportPanel: React.FC<ErrorReportPanelProps> = ({ isVisible, onClose }) => {
  const [stats, setStats] = useState(errorReporting.getErrorStats());
  const [errors, setErrors] = useState(errorReporting.getErrors({ limit: 20 }));
  const [filter, setFilter] = useState({
    type: 'all',
    severity: 'all',
    unresolved: false,
  });

  useEffect(() => {
    if (isVisible) {
      refreshData();
    }
  }, [isVisible]);

  const refreshData = () => {
    setStats(errorReporting.getErrorStats());
    setErrors(errorReporting.getErrors(getFilterOptions()));
  };

  const getFilterOptions = () => {
    const options: any = { limit: 50 };
    if (filter.type !== 'all') options.type = filter.type;
    if (filter.severity !== 'all') options.severity = filter.severity;
    if (filter.unresolved) options.unresolved = true;
    return options;
  };

  const copyErrorReport = async () => {
    try {
      let report = errorReporting.exportErrors();

      // Attempt to retrieve backend logs
      if (window.__TAURI_INTERNALS__) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const backendLogs = await invoke<string>('get_backend_logs');
          if (backendLogs) {
            report += '\n\n=== BACKEND LOGS ===\n';
            report += backendLogs.length > 50000
              ? backendLogs.slice(-50000)
              : backendLogs;
          }
        } catch (backendErr) {
          console.warn('Could not fetch backend logs', backendErr);
        }
      }

      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(report);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = report;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }

      showNotification('✅ Raport błędów i logi skopiowane!', 'success');
    } catch (error) {
      showNotification('❌ Nie udało się skopiować raportu', 'error');
    }
  };

  const clearAllErrors = () => {
    if (confirm('Czy na pewno chcesz usunąć wszystkie zapisane błędy?')) {
      errorReporting.clearErrors();
      refreshData();
      showNotification('🧹 Wszystkie błędy usunięte', 'success');
    }
  };

  const resolveError = (errorId: string) => {
    errorReporting.resolveError(errorId);
    refreshData();
    showNotification('✅ Błąd oznaczony jako rozwiązany', 'success');
  };

  const showNotification = (message: string, type: 'success' | 'error') => {
    const notification = document.createElement('div');
    const bgColor = type === 'success' ? 'bg-green-600' : 'bg-red-600';
    notification.className = `fixed top-4 right-4 ${bgColor} text-white px-4 py-2 rounded-lg shadow-lg z-50 flex items-center gap-2`;
    notification.innerHTML = message;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.remove();
    }, 3000);
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'text-red-400';
      case 'high': return 'text-orange-400';
      case 'medium': return 'text-yellow-400';
      case 'low': return 'text-blue-400';
      default: return 'text-gray-400';
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical': return '🚨';
      case 'high': return '⚠️';
      case 'medium': return '⚡';
      case 'low': return 'ℹ️';
      default: return '❓';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'javascript': return '🟨';
      case 'network': return '🌐';
      case 'plugin': return '🔌';
      case 'system': return '⚙️';
      case 'user': return '👤';
      default: return '❓';
    }
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg p-6 max-w-6xl w-full max-h-[90vh] overflow-hidden mx-4">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            🚨 Raport Błędów Systemu
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-2xl"
          >
            ✕
          </button>
        </div>

        {/* Statistics */}
        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          <h3 className="text-white font-semibold mb-3">Statystyki</h3>
          <div className="grid grid-cols-4 gap-4 text-center">
            <div>
              <div className="text-2xl text-white">{stats.total}</div>
              <div className="text-gray-400 text-sm">Wszystkie</div>
            </div>
            <div>
              <div className="text-2xl text-red-400">{stats.unresolved}</div>
              <div className="text-gray-400 text-sm">Nierozwiązane</div>
            </div>
            <div>
              <div className="text-2xl text-orange-400">{stats.bySeverity.high || 0}</div>
              <div className="text-gray-400 text-sm">Krytyczne</div>
            </div>
            <div>
              <div className="text-2xl text-yellow-400">{stats.bySeverity.medium || 0}</div>
              <div className="text-gray-400 text-sm">Średnie</div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          <h3 className="text-white font-semibold mb-3">Filtry</h3>
          <div className="flex gap-4 flex-wrap">
            <select
              value={filter.type}
              onChange={(e) => setFilter({ ...filter, type: e.target.value })}
              className="bg-gray-700 text-white px-3 py-2 rounded border border-gray-600"
            >
              <option value="all">Wszystkie typy</option>
              <option value="javascript">JavaScript</option>
              <option value="network">Sieć</option>
              <option value="plugin">Plugin</option>
              <option value="system">System</option>
              <option value="user">Użytkownik</option>
            </select>

            <select
              value={filter.severity}
              onChange={(e) => setFilter({ ...filter, severity: e.target.value })}
              className="bg-gray-700 text-white px-3 py-2 rounded border border-gray-600"
            >
              <option value="all">Wszystkie poziomy</option>
              <option value="critical">Krytyczne</option>
              <option value="high">Wysokie</option>
              <option value="medium">Średnie</option>
              <option value="low">Niskie</option>
            </select>

            <label className="flex items-center gap-2 text-white">
              <input
                type="checkbox"
                checked={filter.unresolved}
                onChange={(e) => setFilter({ ...filter, unresolved: e.target.checked })}
                className="rounded"
              />
              Tylko nierozwiązane
            </label>

            <button
              onClick={refreshData}
              className="bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700"
            >
              🔄 Odśwież
            </button>
          </div>
        </div>

        {/* Error List */}
        <div className="bg-gray-800 rounded-lg p-4 mb-6 max-h-96 overflow-y-auto">
          <h3 className="text-white font-semibold mb-3">Lista Błędów</h3>
          {errors.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <div className="text-4xl mb-2">✅</div>
              <div>Brak błędów do wyświetlenia</div>
            </div>
          ) : (
            <div className="space-y-3">
              {errors.map((error) => (
                <div
                  key={error.id}
                  className={`bg-gray-700 rounded-lg p-3 border-l-4 ${error.resolved ? 'border-gray-500 opacity-50' : 'border-red-500'
                    }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-lg">{getSeverityIcon(error.severity)}</span>
                        <span className="text-lg">{getTypeIcon(error.type)}</span>
                        <span className={`font-medium ${getSeverityColor(error.severity)}`}>
                          {error.severity.toUpperCase()}
                        </span>
                        {error.resolved && (
                          <span className="text-green-400 text-sm">✅ Rozwiązany</span>
                        )}
                      </div>
                      <div className="text-white font-medium mb-1">{error.message}</div>
                      <div className="text-gray-400 text-sm">
                        ID: {error.id} | {new Date(error.timestamp).toLocaleString('pl-PL')}
                      </div>
                      {error.context.component && (
                        <div className="text-gray-500 text-xs mt-1">
                          Komponent: {error.context.component}
                          {error.context.action && ` | Akcja: ${error.context.action}`}
                        </div>
                      )}
                      {error.details && (
                        <details className="mt-2">
                          <summary className="text-gray-500 text-sm cursor-pointer hover:text-gray-400">
                            Szczegóły
                          </summary>
                          <pre className="text-gray-600 text-xs mt-2 bg-gray-900 p-2 rounded overflow-x-auto">
                            {JSON.stringify(error.details, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                    <div className="flex gap-2 ml-4">
                      {!error.resolved && (
                        <button
                          onClick={() => resolveError(error.id)}
                          className="text-green-400 hover:text-green-300 text-sm"
                          title="Oznacz jako rozwiązany"
                        >
                          ✅
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-between items-center pt-4 border-t border-gray-700">
          <div className="flex gap-3">
            <button
              onClick={copyErrorReport}
              className="bg-orange-600 text-white px-4 py-2 rounded hover:bg-orange-700 flex items-center gap-2"
            >
              📋 Kopiuj raport
            </button>
            <button
              onClick={clearAllErrors}
              className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 flex items-center gap-2"
            >
              🧹 Wyczyść błędy
            </button>
          </div>
          <button
            onClick={onClose}
            className="bg-gray-700 text-white px-4 py-2 rounded hover:bg-gray-600"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
};
