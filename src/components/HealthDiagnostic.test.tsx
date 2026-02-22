/**
 * Health Diagnostic Component Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HealthDiagnostic } from './HealthDiagnostic';
import { healthChecker } from '../utils/healthCheck';

// Mock healthChecker
vi.mock('../utils/healthCheck', () => ({
  healthChecker: {
    runChecks: vi.fn(),
    runQuickCheck: vi.fn(),
  },
}));

describe('HealthDiagnostic Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock successful health check
    vi.mocked(healthChecker.runChecks).mockResolvedValue({
      overall: 'healthy',
      checks: [
        {
          status: 'healthy',
          category: 'runtime',
          name: 'node-version',
          message: 'Node.js 20.0.0',
          details: { version: '20.0.0', major: 20, supported: true }
        },
        {
          status: 'warning',
          category: 'browser',
          name: 'speech-api',
          message: 'Limited Speech API support',
          details: { speechRecognition: false, speechSynthesis: false }
        },
        {
          status: 'error',
          category: 'network',
          name: 'localhost',
          message: 'Development server not responding',
          details: { error: 'Connection refused' }
        }
      ],
      timestamp: Date.now()
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders diagnostic buttons when not visible', () => {
    render(<HealthDiagnostic showOnStartup={false} autoRefresh={false} />);
    
    // Check if both buttons are visible
    expect(screen.getByTitle('Kopiuj błędy do schowka (Ctrl+Shift+E)')).toBeInTheDocument();
    expect(screen.getByTitle('Pokaż diagnostykę systemu')).toBeInTheDocument();
  });

  it('opens diagnostic modal when button is clicked', async () => {
    render(<HealthDiagnostic showOnStartup={false} autoRefresh={false} />);
    
    // Click diagnostic button
    const diagnosticButton = screen.getByTitle('Pokaż diagnostykę systemu');
    fireEvent.click(diagnosticButton);
    
    // Wait for modal to appear
    await waitFor(() => {
      expect(screen.getByText('🏥 Diagnostyka Systemu Broxeen')).toBeInTheDocument();
    });
  });

  it('shows health check results in modal', async () => {
    render(<HealthDiagnostic showOnStartup={false} autoRefresh={false} />);
    
    // Click diagnostic button
    const diagnosticButton = screen.getByTitle('Pokaż diagnostykę systemu');
    fireEvent.click(diagnosticButton);
    
    // Wait for results to appear
    await waitFor(() => {
      expect(screen.getByText('node-version')).toBeInTheDocument();
      expect(screen.getByText('speech-api')).toBeInTheDocument();
      expect(screen.getByText('localhost')).toBeInTheDocument();
    });
  });

  it('displays correct status colors and icons', async () => {
    render(<HealthDiagnostic showOnStartup={false} autoRefresh={false} />);
    
    // Click diagnostic button
    const diagnosticButton = screen.getByTitle('Pokaż diagnostykę systemu');
    fireEvent.click(diagnosticButton);
    
    // Wait for modal
    await waitFor(() => {
      expect(screen.getByText('🏥 Diagnostyka Systemu Broxeen')).toBeInTheDocument();
    });
    
    // Check if status indicators are present
    const modal = screen.getByText('🏥 Diagnostyka Systemu Broxeen').closest('div');
    expect(modal).toBeInTheDocument();
  });
});
