import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DeviceStrip from './DeviceStrip';
import { ConfiguredDeviceRepository } from '../persistence/configuredDeviceRepository';
import type { ConfiguredDevice } from '../persistence/configuredDeviceRepository';
import type { DbAdapter } from '../persistence/databaseManager';

const makeDevice = (overrides: Partial<ConfiguredDevice> = {}): ConfiguredDevice => ({
  id: 'cd_1',
  device_id: null,
  label: 'Kamera wejście',
  ip: '192.168.1.10',
  device_type: 'camera',
  rtsp_url: 'rtsp://192.168.1.10:554/stream',
  http_url: null,
  username: 'admin',
  password: 'pass',
  stream_path: null,
  monitor_enabled: true,
  monitor_interval_ms: 3000,
  last_snapshot_at: null,
  notes: null,
  created_at: Date.now(),
  updated_at: Date.now(),
  ...overrides,
});

const mockDb = {} as DbAdapter;

describe('DeviceStrip', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders add-device button when no devices', async () => {
    vi.spyOn(ConfiguredDeviceRepository.prototype, 'listAll').mockResolvedValue([]);
    render(<DeviceStrip devicesDb={mockDb} onAddDevice={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTitle('Dodaj urządzenie')).toBeInTheDocument();
    });
  });

  it('calls onAddDevice when add button clicked (empty state)', async () => {
    vi.spyOn(ConfiguredDeviceRepository.prototype, 'listAll').mockResolvedValue([]);
    const onAdd = vi.fn();
    render(<DeviceStrip devicesDb={mockDb} onAddDevice={onAdd} />);

    await waitFor(() => screen.getByTitle('Dodaj urządzenie'));
    fireEvent.click(screen.getByTitle('Dodaj urządzenie'));
    expect(onAdd).toHaveBeenCalled();
  });

  it('renders device labels in strip when devices exist', async () => {
    vi.spyOn(ConfiguredDeviceRepository.prototype, 'listAll').mockResolvedValue([
      makeDevice({ id: 'cd_1', label: 'Kamera A', ip: '192.168.1.10' }),
      makeDevice({ id: 'cd_2', label: 'Kamera B', ip: '192.168.1.11' }),
    ]);

    render(<DeviceStrip devicesDb={mockDb} />);

    await waitFor(() => {
      expect(screen.getByText('Kamera A')).toBeInTheDocument();
      expect(screen.getByText('Kamera B')).toBeInTheDocument();
    });
  });

  it('shows +N overflow indicator when more than 4 devices', async () => {
    const devices = Array.from({ length: 6 }, (_, i) =>
      makeDevice({ id: `cd_${i}`, label: `Kamera ${i}`, ip: `192.168.1.${10 + i}` }),
    );
    vi.spyOn(ConfiguredDeviceRepository.prototype, 'listAll').mockResolvedValue(devices);

    render(<DeviceStrip devicesDb={mockDb} />);

    await waitFor(() => {
      expect(screen.getByText('+2')).toBeInTheDocument();
    });
  });

  it('expands dropdown on strip button click', async () => {
    vi.spyOn(ConfiguredDeviceRepository.prototype, 'listAll').mockResolvedValue([
      makeDevice(),
    ]);

    render(<DeviceStrip devicesDb={mockDb} />);

    await waitFor(() => screen.getByText('Kamera wejście'));

    const toggleBtn = screen.getByTitle('1 skonfigurowanych urządzeń');
    fireEvent.click(toggleBtn);

    expect(screen.getByText('Skonfigurowane urządzenia')).toBeInTheDocument();
  });

  it('dispatches broxeen:chat_action execute for monitor button', async () => {
    vi.spyOn(ConfiguredDeviceRepository.prototype, 'listAll').mockResolvedValue([
      makeDevice({ id: 'cd_1', ip: '192.168.1.10' }),
    ]);

    const dispatched: CustomEvent[] = [];
    window.addEventListener('broxeen:chat_action', (e) => dispatched.push(e as CustomEvent));

    render(<DeviceStrip devicesDb={mockDb} />);
    await waitFor(() => screen.getByText('Kamera wejście'));

    // Open dropdown
    fireEvent.click(screen.getByTitle('1 skonfigurowanych urządzeń'));

    // Click monitor button (EyeOff/Eye icon button with title "Monitoruj")
    const monitorBtn = screen.getByTitle('Monitoruj');
    fireEvent.click(monitorBtn);

    expect(dispatched.length).toBeGreaterThan(0);
    expect(dispatched[0].detail.mode).toBe('execute');
    expect(dispatched[0].detail.text).toContain('192.168.1.10');

    window.removeEventListener('broxeen:chat_action', (e) => dispatched.push(e as CustomEvent));
  });

  it('dispatches broxeen:chat_action execute for live preview button', async () => {
    vi.spyOn(ConfiguredDeviceRepository.prototype, 'listAll').mockResolvedValue([
      makeDevice({ id: 'cd_1', ip: '192.168.1.10', rtsp_url: 'rtsp://192.168.1.10:554/stream' }),
    ]);

    const dispatched: CustomEvent[] = [];
    const handler = (e: Event) => dispatched.push(e as CustomEvent);
    window.addEventListener('broxeen:chat_action', handler);

    render(<DeviceStrip devicesDb={mockDb} />);
    await waitFor(() => screen.getByText('Kamera wejście'));

    fireEvent.click(screen.getByTitle('1 skonfigurowanych urządzeń'));

    const liveBtn = screen.getByTitle('Podgląd live');
    fireEvent.click(liveBtn);

    expect(dispatched.length).toBeGreaterThan(0);
    expect(dispatched[0].detail.mode).toBe('execute');
    expect(dispatched[0].detail.text).toContain('192.168.1.10');

    window.removeEventListener('broxeen:chat_action', handler);
  });

  it('does not render live preview button when no rtsp_url', async () => {
    vi.spyOn(ConfiguredDeviceRepository.prototype, 'listAll').mockResolvedValue([
      makeDevice({ rtsp_url: null }),
    ]);

    render(<DeviceStrip devicesDb={mockDb} />);
    await waitFor(() => screen.getByText('Kamera wejście'));

    fireEvent.click(screen.getByTitle('1 skonfigurowanych urządzeń'));

    expect(screen.queryByTitle('Podgląd live')).not.toBeInTheDocument();
  });

  it('dispatches prefill action when "Dodaj urządzenie przez chat" clicked', async () => {
    vi.spyOn(ConfiguredDeviceRepository.prototype, 'listAll').mockResolvedValue([
      makeDevice(),
    ]);

    const dispatched: CustomEvent[] = [];
    const handler = (e: Event) => dispatched.push(e as CustomEvent);
    window.addEventListener('broxeen:chat_action', handler);

    render(<DeviceStrip devicesDb={mockDb} />);
    await waitFor(() => screen.getByText('Kamera wejście'));

    fireEvent.click(screen.getByTitle('1 skonfigurowanych urządzeń'));
    fireEvent.click(screen.getByText('Dodaj urządzenie przez chat'));

    expect(dispatched.length).toBeGreaterThan(0);
    expect(dispatched[0].detail.mode).toBe('prefill');
    expect(dispatched[0].detail.text).toContain('dodaj kamerę');

    window.removeEventListener('broxeen:chat_action', handler);
  });

  it('does not load devices when devicesDb is null', async () => {
    const spy = vi.spyOn(ConfiguredDeviceRepository.prototype, 'listAll');
    render(<DeviceStrip devicesDb={null} />);

    await new Promise((r) => setTimeout(r, 50));
    expect(spy).not.toHaveBeenCalled();
  });

  it('reloads devices on broxeen:devices_changed event', async () => {
    const spy = vi.spyOn(ConfiguredDeviceRepository.prototype, 'listAll').mockResolvedValue([
      makeDevice(),
    ]);

    render(<DeviceStrip devicesDb={mockDb} />);
    await waitFor(() => screen.getByText('Kamera wejście'));

    const callsBefore = spy.mock.calls.length;
    window.dispatchEvent(new CustomEvent('broxeen:devices_changed'));

    await waitFor(() => {
      expect(spy.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});
