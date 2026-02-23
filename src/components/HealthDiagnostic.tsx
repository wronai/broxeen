/**
 * Health Diagnostic Component - Wyświetla status zdrowia aplikacji
 */

import React, { useState, useEffect } from 'react';
import { healthChecker, type HealthReport, type HealthCheckResult } from '../utils/healthCheck';

interface HealthDiagnosticProps {
  showOnStartup?: boolean;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export const HealthDiagnostic: React.FC<HealthDiagnosticProps> = ({
  showOnStartup = true,
  autoRefresh = false,
  refreshInterval = 30000
}) => {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isVisible, setIsVisible] = useState(showOnStartup);

  const copyErrorsToClipboard = async () => {
    try {
      // Run health check to get current status
      const currentReport = await healthChecker.runChecks();
      
      // Format the report for clipboard
      const timestamp = new Date().toLocaleString('pl-PL');
      const errors = currentReport.checks.filter(c => c.status === 'error');
      const warnings = currentReport.checks.filter(c => c.status === 'warning');
      
      let reportText = `🏥 BROXEEN HEALTH REPORT - ${timestamp}\n`;
      reportText += `Overall Status: ${currentReport.overall.toUpperCase()}\n`;
      reportText += `Total Checks: ${currentReport.checks.length}\n\n`;
      
      if (errors.length > 0) {
        reportText += `❌ ERRORS (${errors.length}):\n`;
        errors.forEach(error => {
          reportText += `  • [${error.category.toUpperCase()}] ${error.name}: ${error.message}\n`;
          if (error.details) {
            // Format details as simple string, not JSON
            const detailsStr = typeof error.details === 'string' 
              ? error.details 
              : JSON.stringify(error.details, null, 2);
            reportText += `    Details: ${detailsStr}\n`;
          }
        });
        reportText += '\n';
      }
      
      if (warnings.length > 0) {
        reportText += `⚠️ WARNINGS (${warnings.length}):\n`;
        warnings.forEach(warning => {
          reportText += `  • [${warning.category.toUpperCase()}] ${warning.name}: ${warning.message}\n`;
          if (warning.details) {
            // Format details as simple string, not JSON
            const detailsStr = typeof warning.details === 'string' 
              ? warning.details 
              : JSON.stringify(warning.details, null, 2);
            reportText += `    Details: ${detailsStr}\n`;
          }
        });
        reportText += '\n';
      }
      
      if (errors.length === 0 && warnings.length === 0) {
        reportText += `✅ All checks passed!\n`;
      }
      
      // Add system info
      reportText += `\n📋 SYSTEM INFO:\n`;
      reportText += `  • Platform: ${navigator.platform}\n`;
      reportText += `  • User Agent: ${navigator.userAgent}\n`;
      reportText += `  • URL: ${window.location.href}\n`;
      reportText += `  • Timestamp: ${timestamp}\n`;
      
      // Try modern clipboard API first
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(reportText);
      } else {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = reportText;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      
      // Show success notification
      showNotification('✅ Błędy skopiowane do schowka!', 'success');
      
    } catch (error) {
      console.error('Failed to copy errors to clipboard:', error);
      showNotification('❌ Nie udało się skopiować błędów', 'error');
    }
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

  const runHealthCheck = async () => {
    setIsLoading(true);
    try {
      const result = await healthChecker.runChecks();
      setReport(result);
    } catch (error) {
      console.error('Health check failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isVisible) {
      runHealthCheck();
    }

    if (autoRefresh && isVisible) {
      const interval = setInterval(runHealthCheck, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [isVisible, autoRefresh, refreshInterval]);

  // Add keyboard shortcut for copying errors (Ctrl+Shift+E)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        copyErrorsToClipboard();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!isVisible) {
    return (
      <div className="fixed bottom-24 right-4 flex flex-nowrap items-center gap-1 z-50">
        <button
          onClick={() => copyErrorsToClipboard()}
          className="bg-orange-600 text-white px-2 py-1.5 rounded-lg shadow-lg hover:bg-orange-700 transition-colors flex items-center gap-1 text-xs whitespace-nowrap"
          title="Kopiuj błędy do schowka (Ctrl+Shift+E)"
        >
          📋 Kopiuj błędy
        </button>
        <button
          onClick={() => setIsVisible(true)}
          className="bg-blue-600 text-white px-2 py-1.5 rounded-lg shadow-lg hover:bg-blue-700 transition-colors flex items-center gap-1 text-xs whitespace-nowrap"
          title="Pokaż diagnostykę systemu"
        >
          🏥 Diagnostyka
        </button>
      </div>
    );
  }

  const getStatusColor = (status: HealthCheckResult['status']) => {
    switch (status) {
      case 'healthy': return 'text-green-400';
      case 'warning': return 'text-yellow-400';
      case 'error': return 'text-red-400';
    }
  };

  const getStatusIcon = (status: HealthCheckResult['status']) => {
    switch (status) {
      case 'healthy': return '✅';
      case 'warning': return '⚠️';
      case 'error': return '❌';
    }
  };

  const getOverallStatus = () => {
    if (!report) return { text: 'Sprawdzanie...', color: 'text-gray-400', icon: '🔄' };
    
    switch (report.overall) {
      case 'healthy': return { text: 'Zdrowy', color: 'text-green-400', icon: '✅' };
      case 'degraded': return { text: 'Ograniczony', color: 'text-yellow-400', icon: '⚠️' };
      case 'unhealthy': return { text: 'Błędy krytyczne', color: 'text-red-400', icon: '❌' };
    }
  };

  const overallStatus = getOverallStatus();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg p-6 max-w-4xl w-full max-h-[80vh] overflow-y-auto mx-4">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-white">
            🏥 Diagnostyka Systemu Broxeen
          </h2>
          <div className="flex items-center gap-4">
            <div className={`flex items-center gap-2 ${overallStatus.color}`}>
              <span className="text-2xl">{overallStatus.icon}</span>
              <span className="font-semibold">{overallStatus.text}</span>
            </div>
            <button
              onClick={() => setIsVisible(false)}
              className="text-gray-400 hover:text-white text-2xl"
            >
              ✕
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
            <p className="text-gray-400 mt-4">Sprawdzanie zdrowia systemu...</p>
          </div>
        ) : report ? (
          <div className="space-y-6">
            {/* Podsumowanie */}
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-white font-semibold mb-3">Podsumowanie</h3>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-2xl text-green-400">
                    {report.checks.filter(c => c.status === 'healthy').length}
                  </div>
                  <div className="text-gray-400 text-sm">Poprawne</div>
                </div>
                <div>
                  <div className="text-2xl text-yellow-400">
                    {report.checks.filter(c => c.status === 'warning').length}
                  </div>
                  <div className="text-gray-400 text-sm">Ostrzeżenia</div>
                </div>
                <div>
                  <div className="text-2xl text-red-400">
                    {report.checks.filter(c => c.status === 'error').length}
                  </div>
                  <div className="text-gray-400 text-sm">Błędy</div>
                </div>
              </div>
              <div className="text-gray-500 text-sm mt-2 text-center">
                Ostatnie sprawdzenie: {new Date(report.timestamp).toLocaleString('pl-PL')}
              </div>
            </div>

            {/* Szczegółowe wyniki */}
            <div className="space-y-4">
              <h3 className="text-white font-semibold">Szczegółowe wyniki</h3>
              
              {['runtime', 'browser', 'network', 'tauri', 'dependencies'].map(category => {
                const categoryChecks = report.checks.filter(c => c.category === category);
                if (categoryChecks.length === 0) return null;

                return (
                  <div key={category} className="bg-gray-800 rounded-lg p-4">
                    <h4 className="text-white font-medium mb-3 capitalize">
                      {category === 'runtime' && '🖥️ Środowisko uruchomieniowe'}
                      {category === 'browser' && '🌐 Przeglądarka'}
                      {category === 'network' && '📡 Sieć'}
                      {category === 'tauri' && '🦀 Tauri'}
                      {category === 'dependencies' && '📦 Zależności'}
                    </h4>
                    <div className="space-y-2">
                      {categoryChecks.map((check, index) => (
                        <div key={index} className="flex items-start gap-3">
                          <span className="text-lg">{getStatusIcon(check.status)}</span>
                          <div className="flex-1">
                            <div className={`font-medium ${getStatusColor(check.status)}`}>
                              {check.name}
                            </div>
                            <div className="text-gray-400 text-sm">{check.message}</div>
                            {check.details && (
                              <details className="mt-2">
                                <summary className="text-gray-500 text-sm cursor-pointer hover:text-gray-400">
                                  Szczegóły
                                </summary>
                                <pre className="text-gray-600 text-xs mt-2 bg-gray-900 p-2 rounded overflow-x-auto">
                                  {JSON.stringify(check.details, null, 2)}
                                </pre>
                              </details>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Akcje */}
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
              <button
                onClick={copyErrorsToClipboard}
                className="bg-orange-600 text-white px-4 py-2 rounded hover:bg-orange-700 transition-colors flex items-center gap-2"
                title="Kopiuj błędy do schowka (Ctrl+Shift+E)"
              >
                📋 Kopiuj błędy
              </button>
              <button
                onClick={runHealthCheck}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
              >
                🔄 Odśwież
              </button>
              <button
                onClick={() => setIsVisible(false)}
                className="bg-gray-700 text-white px-4 py-2 rounded hover:bg-gray-600 transition-colors"
              >
                Zamknij
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

// Hook dla łatwego dostępu do diagnostyki
export const useHealthDiagnostic = () => {
  const [isHealthy, setIsHealthy] = useState<boolean | null>(null);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const status = await healthChecker.runQuickCheck();
        setIsHealthy(status === 'healthy');
      } catch (error) {
        console.error('Health check failed:', error);
        setIsHealthy(false);
      }
    };

    checkHealth();
  }, []);

  return { isHealthy };
};
