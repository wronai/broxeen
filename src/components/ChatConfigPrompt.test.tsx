/**
 * Tests for ChatConfigPrompt component
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatConfigPrompt, buildApiKeyPrompt, buildNetworkConfigPrompt, buildModelSelectionPrompt, buildConfigOverviewPrompt, buildSshHostPrompt, buildCameraActionPrompt } from './ChatConfigPrompt';
import type { ConfigPromptData } from './ChatConfigPrompt';

// Mock configStore
vi.mock('../config/configStore', () => {
  const store: Record<string, unknown> = {
    'llm.apiKey': '',
    'llm.model': 'google/gemini-3-flash-preview',
    'network.defaultSubnet': '192.168.1',
    'locale.locale': 'pl-PL',
  };
  return {
    configStore: {
      get: vi.fn((path: string) => store[path]),
      set: vi.fn((path: string, value: unknown) => { store[path] = value; }),
      getAll: vi.fn(() => ({
        llm: { apiKey: '', model: 'google/gemini-3-flash-preview' },
        network: { defaultSubnet: '192.168.1' },
        locale: { locale: 'pl-PL' },
      })),
      getConfigStatus: vi.fn(() => ({
        llmConfigured: false,
        sttConfigured: false,
        networkSubnet: '192.168.1',
        locale: 'pl-PL',
        missingFields: ['llm.apiKey'],
      })),
      reset: vi.fn(),
    },
  };
});

describe('ChatConfigPrompt', () => {
  const mockOnPrefill = vi.fn();
  const mockOnExecute = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders action buttons', () => {
    const data: ConfigPromptData = {
      title: 'Test',
      actions: [
        { id: 'a1', label: 'Action 1', type: 'prefill', prefillText: 'test1', variant: 'primary' },
        { id: 'a2', label: 'Action 2', type: 'execute', executeQuery: 'do something', variant: 'secondary' },
      ],
      layout: 'buttons',
    };

    render(<ChatConfigPrompt data={data} onPrefill={mockOnPrefill} onExecute={mockOnExecute} />);

    expect(screen.getByTestId('config-action-a1')).toBeDefined();
    expect(screen.getByTestId('config-action-a2')).toBeDefined();
    expect(screen.getByText('Action 1')).toBeDefined();
    expect(screen.getByText('Action 2')).toBeDefined();
  });

  it('calls onPrefill when prefill action is clicked', () => {
    const data: ConfigPromptData = {
      title: 'Test',
      actions: [
        { id: 'prefill-test', label: 'Fill', type: 'prefill', prefillText: 'hello world' },
      ],
      layout: 'buttons',
    };

    render(<ChatConfigPrompt data={data} onPrefill={mockOnPrefill} onExecute={mockOnExecute} />);
    fireEvent.click(screen.getByTestId('config-action-prefill-test'));
    expect(mockOnPrefill).toHaveBeenCalledWith('hello world');
  });

  it('calls onExecute when execute action is clicked', () => {
    const data: ConfigPromptData = {
      title: 'Test',
      actions: [
        { id: 'exec-test', label: 'Run', type: 'execute', executeQuery: 'skanuj sieć' },
      ],
      layout: 'buttons',
    };

    render(<ChatConfigPrompt data={data} onPrefill={mockOnPrefill} onExecute={mockOnExecute} />);
    fireEvent.click(screen.getByTestId('config-action-exec-test'));
    expect(mockOnExecute).toHaveBeenCalledWith('skanuj sieć');
  });

  it('renders card layout', () => {
    const data: ConfigPromptData = {
      title: 'Cards',
      actions: [
        { id: 'card1', label: 'Card One', icon: '🔍', type: 'execute', executeQuery: 'test', description: 'A card' },
      ],
      layout: 'cards',
    };

    render(<ChatConfigPrompt data={data} onPrefill={mockOnPrefill} onExecute={mockOnExecute} />);
    expect(screen.getByTestId('config-card-card1')).toBeDefined();
    expect(screen.getByText('Card One')).toBeDefined();
    expect(screen.getByText('A card')).toBeDefined();
  });

  it('renders inline layout', () => {
    const data: ConfigPromptData = {
      title: 'Inline',
      actions: [
        { id: 'i1', label: 'Opt 1', type: 'prefill', prefillText: 'a' },
        { id: 'i2', label: 'Opt 2', type: 'prefill', prefillText: 'b' },
      ],
      layout: 'inline',
    };

    render(<ChatConfigPrompt data={data} onPrefill={mockOnPrefill} onExecute={mockOnExecute} />);
    expect(screen.getByText('Opt 1')).toBeDefined();
    expect(screen.getByText('Opt 2')).toBeDefined();
  });

  it('marks action as completed after click (set_config)', async () => {
    const { configStore } = await import('../config/configStore');
    const data: ConfigPromptData = {
      title: 'Test',
      actions: [
        { id: 'set-test', label: 'Set Model', type: 'set_config', configPath: 'llm.model', configValue: 'openai/gpt-4o', variant: 'primary' },
      ],
      layout: 'buttons',
    };

    render(<ChatConfigPrompt data={data} onPrefill={mockOnPrefill} onExecute={mockOnExecute} />);
    const btn = screen.getByTestId('config-action-set-test');
    fireEvent.click(btn);

    expect(configStore.set).toHaveBeenCalledWith('llm.model', 'openai/gpt-4o');
    // After click, button should be disabled
    expect(btn).toHaveAttribute('disabled');
  });
});

describe('Config prompt builders', () => {
  it('buildApiKeyPrompt returns valid prompt', () => {
    const prompt = buildApiKeyPrompt();
    expect(prompt.title).toBeTruthy();
    expect(prompt.editableFields).toContain('llm.apiKey');
    expect(prompt.actions.length).toBeGreaterThan(0);
  });

  it('buildNetworkConfigPrompt with subnet', () => {
    const prompt = buildNetworkConfigPrompt('192.168.188');
    expect(prompt.actions.some(a => a.configValue === '192.168.188')).toBe(true);
    expect(prompt.actions.some(a => a.type === 'execute')).toBe(true);
  });

  it('buildNetworkConfigPrompt without subnet', () => {
    const prompt = buildNetworkConfigPrompt();
    expect(prompt.actions.some(a => a.type === 'prefill')).toBe(true);
  });

  it('buildModelSelectionPrompt returns model choices', () => {
    const prompt = buildModelSelectionPrompt();
    expect(prompt.actions.length).toBeGreaterThanOrEqual(3);
    expect(prompt.actions.every(a => a.type === 'set_config')).toBe(true);
  });

  it('buildConfigOverviewPrompt returns status', () => {
    const prompt = buildConfigOverviewPrompt();
    expect(prompt.actions.length).toBeGreaterThanOrEqual(3);
    expect(prompt.description).toBeTruthy();
  });

  it('buildSshHostPrompt with known hosts', () => {
    const prompt = buildSshHostPrompt(['10.0.0.1', '10.0.0.2']);
    expect(prompt.actions.some(a => a.prefillText?.includes('10.0.0.1'))).toBe(true);
    expect(prompt.actions.some(a => a.id === 'ssh-custom')).toBe(true);
  });

  it('buildCameraActionPrompt returns camera actions', () => {
    const prompt = buildCameraActionPrompt('192.168.1.100', 'Hikvision');
    expect(prompt.title).toBe('Hikvision');
    expect(prompt.actions.some(a => a.executeQuery?.includes('192.168.1.100'))).toBe(true);
  });
});
