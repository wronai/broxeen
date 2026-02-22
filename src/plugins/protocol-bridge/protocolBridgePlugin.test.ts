/**
 * ProtocolBridgePlugin v2 tests
 * Covers: MQTT, REST, WebSocket, SSE, GraphQL ↔ text ↔ voice
 * + natural language detection, action hints, auto-protocol detection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProtocolBridgePlugin } from './protocolBridgePlugin';
import type { PluginContext } from '../../core/types';

const browserCtx: PluginContext = {
  isTauri: false,
  scope: 'network',
};

const mqttCtx: PluginContext = {
  isTauri: false,
  scope: 'local',
  mqtt: {
    config: {
      brokerUrl: 'ws://localhost:9001',
      topics: ['home/sensors/temperature', 'home/sensors/humidity'],
      topicLabels: { 'home/sensors/temperature': 'Temperatura' },
    },
    client: {
      connect: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      publish: vi.fn().mockResolvedValue(undefined),
      getLastValue: vi.fn().mockReturnValue('22.5°C'),
      disconnect: vi.fn().mockResolvedValue(undefined),
    },
  },
};

describe('ProtocolBridgePlugin v2', () => {
  let plugin: ProtocolBridgePlugin;

  beforeEach(() => {
    plugin = new ProtocolBridgePlugin();
  });

  // ─── Metadata ──────────────────────────────────────────

  it('has correct id, name, and version', () => {
    expect(plugin.id).toBe('protocol-bridge');
    expect(plugin.name).toBe('Protocol Bridge');
    expect(plugin.version).toBe('2.0.0');
  });

  it('supports bridge intents', () => {
    expect(plugin.supportedIntents).toContain('bridge:read');
    expect(plugin.supportedIntents).toContain('bridge:send');
    expect(plugin.supportedIntents).toContain('bridge:add');
    expect(plugin.supportedIntents).toContain('bridge:remove');
    expect(plugin.supportedIntents).toContain('bridge:list');
    expect(plugin.supportedIntents).toContain('bridge:status');
  });

  // ─── canHandle — all protocols ─────────────────────────

  it('canHandle MQTT commands', async () => {
    expect(await plugin.canHandle('bridge mqtt home/sensors/temp', browserCtx)).toBe(true);
    expect(await plugin.canHandle('wyślij mqtt home/lights on', browserCtx)).toBe(true);
    expect(await plugin.canHandle('mqtt tekst', browserCtx)).toBe(true);
  });

  it('canHandle REST commands', async () => {
    expect(await plugin.canHandle('bridge rest GET https://api.example.com', browserCtx)).toBe(true);
    expect(await plugin.canHandle('wyślij rest POST https://api.example.com', browserCtx)).toBe(true);
    expect(await plugin.canHandle('rest voice', browserCtx)).toBe(true);
  });

  it('canHandle WebSocket commands', async () => {
    expect(await plugin.canHandle('bridge ws wss://example.com/feed', browserCtx)).toBe(true);
    expect(await plugin.canHandle('websocket wss://example.com', browserCtx)).toBe(true);
    expect(await plugin.canHandle('połącz ws wss://example.com', browserCtx)).toBe(true);
    expect(await plugin.canHandle('wyślij ws wss://example.com hello', browserCtx)).toBe(true);
  });

  it('canHandle SSE commands', async () => {
    expect(await plugin.canHandle('bridge sse https://api.example.com/events', browserCtx)).toBe(true);
    expect(await plugin.canHandle('sse https://api.example.com/events', browserCtx)).toBe(true);
    expect(await plugin.canHandle('nasłuchuj na zdarzenia z https://api.example.com', browserCtx)).toBe(true);
  });

  it('canHandle GraphQL commands', async () => {
    expect(await plugin.canHandle('bridge graphql https://api.example.com/graphql', browserCtx)).toBe(true);
    expect(await plugin.canHandle('graphql https://api.example.com/graphql { users { name } }', browserCtx)).toBe(true);
    expect(await plugin.canHandle('zapytaj api https://api.example.com/graphql', browserCtx)).toBe(true);
  });

  it('canHandle natural language (PL)', async () => {
    expect(await plugin.canHandle('połącz się z websocketem wss://example.com', browserCtx)).toBe(true);
    expect(await plugin.canHandle('nasłuchuj na strumień danych', browserCtx)).toBe(true);
  });

  it('does not handle unrelated input', async () => {
    expect(await plugin.canHandle('pokaż kamery', browserCtx)).toBe(false);
    expect(await plugin.canHandle('ping 192.168.1.1', browserCtx)).toBe(false);
  });

  // ─── Help / default ────────────────────────────────────

  it('shows help with all 5 protocols when no protocol specified', async () => {
    const result = await plugin.execute('bridge', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('MQTT');
    expect(result.content[0].data).toContain('REST');
    expect(result.content[0].data).toContain('WebSocket');
    expect(result.content[0].data).toContain('SSE');
    expect(result.content[0].data).toContain('GraphQL');
  });

  it('help includes action hints', async () => {
    const result = await plugin.execute('bridge', browserCtx);
    expect(result.content[0].data).toContain('Sugerowane akcje');
  });

  // ─── Add Bridge (all protocols) ────────────────────────

  it('adds MQTT bridge', async () => {
    const result = await plugin.execute('dodaj bridge mqtt ws://192.168.1.10:9001 home/sensors/#', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Most protokołu dodany');
    expect(result.content[0].data).toContain('MQTT');
  });

  it('adds REST bridge', async () => {
    const result = await plugin.execute('dodaj bridge rest https://api.example.com/sensors', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('REST');
  });

  it('adds WebSocket bridge', async () => {
    const result = await plugin.execute('dodaj bridge ws wss://live.example.com/feed', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('WebSocket');
  });

  it('adds SSE bridge', async () => {
    const result = await plugin.execute('dodaj bridge sse https://api.example.com/events', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('SSE');
  });

  it('adds GraphQL bridge', async () => {
    const result = await plugin.execute('dodaj bridge graphql https://api.example.com/graphql', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('GraphQL');
  });

  it('shows error with protocol list when no protocol given', async () => {
    const result = await plugin.execute('dodaj bridge', browserCtx);
    expect(result.status).toBe('error');
    expect(result.content[0].data).toContain('mqtt');
    expect(result.content[0].data).toContain('rest');
    expect(result.content[0].data).toContain('websocket');
    expect(result.content[0].data).toContain('sse');
    expect(result.content[0].data).toContain('graphql');
  });

  it('rejects add without URL', async () => {
    const result = await plugin.execute('dodaj bridge mqtt', browserCtx);
    expect(result.status).toBe('error');
    expect(result.content[0].data).toContain('Brak adresu URL');
  });

  // ─── List Bridges ──────────────────────────────────────

  it('lists bridges (empty) with protocol hints', async () => {
    const result = await plugin.execute('lista bridge', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Brak skonfigurowanych');
    expect(result.content[0].data).toContain('WebSocket');
  });

  it('lists bridges after adding', async () => {
    await plugin.execute('dodaj bridge mqtt ws://broker:9001 home/#', browserCtx);
    await plugin.execute('dodaj bridge ws wss://example.com/feed', browserCtx);
    const result = await plugin.execute('lista bridge', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('MQTT');
    expect(result.content[0].data).toContain('WebSocket');
  });

  // ─── Remove Bridge ────────────────────────────────────

  it('removes bridge by id', async () => {
    const addResult = await plugin.execute('dodaj bridge mqtt ws://broker:9001 home/#', browserCtx);
    const idMatch = addResult.content[0].data.match(/`(mqtt-[a-z0-9]+)`/);
    expect(idMatch).not.toBeNull();

    const removeResult = await plugin.execute(`usuń bridge ${idMatch![1]}`, browserCtx);
    expect(removeResult.status).toBe('success');
    expect(removeResult.content[0].data).toContain('usunięty');
  });

  // ─── Bridge Status ────────────────────────────────────

  it('shows status with protocol breakdown', async () => {
    await plugin.execute('dodaj bridge mqtt ws://broker:9001 home/#', browserCtx);
    await plugin.execute('dodaj bridge ws wss://example.com/feed', browserCtx);
    const result = await plugin.execute('bridge status', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('MQTT');
    expect(result.content[0].data).toContain('WebSocket');
  });

  // ─── MQTT Read ─────────────────────────────────────────

  it('reads MQTT topic from context adapter', async () => {
    const result = await plugin.execute('bridge mqtt home/sensors/temperature', mqttCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('22.5°C');
    expect(mqttCtx.mqtt!.client.getLastValue).toHaveBeenCalledWith('home/sensors/temperature');
  });

  it('shows no-data message for unknown MQTT topic', async () => {
    const ctx: PluginContext = {
      ...browserCtx,
      mqtt: {
        config: { brokerUrl: 'ws://localhost:9001', topics: [] },
        client: {
          connect: vi.fn(), subscribe: vi.fn(), publish: vi.fn(),
          getLastValue: vi.fn().mockReturnValue(null), disconnect: vi.fn(),
        },
      },
    };
    const result = await plugin.execute('bridge mqtt home/sensors/unknown', ctx);
    expect(result.status).toBe('partial');
    expect(result.content[0].data).toContain('Brak danych MQTT');
  });

  // ─── MQTT Send ─────────────────────────────────────────

  it('publishes to MQTT topic', async () => {
    const result = await plugin.execute('wyślij mqtt home/lights/living on', mqttCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Wysłano do MQTT');
    expect(mqttCtx.mqtt!.client.publish).toHaveBeenCalledWith('home/lights/living', 'on');
  });

  it('MQTT send includes action hints', async () => {
    const result = await plugin.execute('wyślij mqtt home/lights/living on', mqttCtx);
    expect(result.content[0].data).toContain('Sugerowane akcje');
  });

  // ─── REST Read ─────────────────────────────────────────

  it('fetches REST endpoint in browser mode', async () => {
    const mockResp = { ok: true, status: 200, text: vi.fn().mockResolvedValue('{"temp": 22.5}') };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResp));

    const result = await plugin.execute('bridge rest GET https://api.example.com/sensors', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('REST GET');
    expect(result.content[0].data).toContain('200');

    vi.unstubAllGlobals();
  });

  // ─── REST Send ─────────────────────────────────────────

  it('sends REST POST', async () => {
    const mockResp = { ok: true, status: 201, text: vi.fn().mockResolvedValue('{"id": 1}') };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResp));

    const result = await plugin.execute('wyślij rest POST https://api.example.com/cmd {"action":"on"}', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('REST POST');

    vi.unstubAllGlobals();
  });

  // ─── WebSocket ─────────────────────────────────────────

  it('registers WebSocket connection in browser mode', async () => {
    const result = await plugin.execute('bridge ws wss://echo.websocket.events', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('WebSocket');
    expect(result.content[0].data).toContain('wss://echo.websocket.events');
  });

  it('sends WebSocket message in browser mode', async () => {
    const result = await plugin.execute('wyślij ws wss://echo.websocket.events hello world', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('hello world');
  });

  it('WebSocket requires URL', async () => {
    const result = await plugin.execute('bridge ws', browserCtx);
    expect(result.status).toBe('error');
    expect(result.content[0].data).toContain('ws://');
  });

  it('auto-detects WebSocket from wss:// URL', async () => {
    const result = await plugin.execute('połącz się z wss://live.example.com/feed', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('WebSocket');
  });

  // ─── SSE ──────────────────────────────────────────────

  it('registers SSE stream in browser mode', async () => {
    const result = await plugin.execute('bridge sse https://api.example.com/events', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('SSE');
    expect(result.content[0].data).toContain('https://api.example.com/events');
  });

  it('SSE requires URL', async () => {
    const result = await plugin.execute('bridge sse', browserCtx);
    expect(result.status).toBe('error');
    expect(result.content[0].data).toContain('https://');
  });

  it('auto-detects SSE from "nasłuchuj" + URL', async () => {
    const result = await plugin.execute('nasłuchuj na zdarzenia z https://api.example.com/events', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('SSE');
  });

  // ─── GraphQL ──────────────────────────────────────────

  it('executes GraphQL query in browser mode', async () => {
    const mockResp = { ok: true, status: 200, text: vi.fn().mockResolvedValue('{"data":{"users":[{"name":"Jan"}]}}') };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResp));

    const result = await plugin.execute('bridge graphql https://api.example.com/graphql { users { name } }', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('GraphQL');
    expect(result.content[0].data).toContain('users');

    vi.unstubAllGlobals();
  });

  it('GraphQL requires URL and query', async () => {
    const result = await plugin.execute('bridge graphql', browserCtx);
    expect(result.status).toBe('error');
  });

  it('auto-detects GraphQL from "zapytaj api"', async () => {
    const mockResp = { ok: true, status: 200, text: vi.fn().mockResolvedValue('{"data":{}}') };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResp));

    const result = await plugin.execute('zapytaj api https://api.example.com/graphql { posts { title } }', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('GraphQL');

    vi.unstubAllGlobals();
  });

  // ─── Send without protocol ────────────────────────────

  it('returns error with all protocols listed when send has no protocol', async () => {
    const result = await plugin.execute('wyślij coś', browserCtx);
    expect(result.status).toBe('error');
    expect(result.content[0].data).toContain('mqtt');
    expect(result.content[0].data).toContain('rest');
    expect(result.content[0].data).toContain('websocket');
  });

  // ─── Voice-friendly summary ────────────────────────────

  it('provides voice-friendly summary in REST responses', async () => {
    const mockResp = { ok: true, status: 200, text: vi.fn().mockResolvedValue('{"temperature": 22.5}') };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResp));

    const result = await plugin.execute('bridge rest GET https://api.example.com/sensors', browserCtx);
    expect(result.content[0].summary).toBeDefined();
    expect(result.content[0].summary!.length).toBeGreaterThan(0);

    vi.unstubAllGlobals();
  });

  // ─── Action Hints in responses ─────────────────────────

  it('MQTT read from cache includes action hints', async () => {
    // Pre-populate cache via send, then read from cache
    await plugin.execute('wyślij mqtt home/test/topic hello', mqttCtx);
    const result = await plugin.execute('bridge mqtt home/test/topic', browserCtx);
    expect(result.status).toBe('success');
    expect(result.content[0].data).toContain('Sugerowane akcje');
  });

  it('add bridge includes action hints', async () => {
    const result = await plugin.execute('dodaj bridge mqtt ws://broker:9001 home/#', browserCtx);
    expect(result.content[0].data).toContain('Sugerowane akcje');
  });

  // ─── Lifecycle ─────────────────────────────────────────

  it('initializes and pre-loads MQTT cache from context', async () => {
    await plugin.initialize(mqttCtx);
    expect(mqttCtx.mqtt!.client.getLastValue).toHaveBeenCalled();
  });

  it('disposes cleanly (clears all state)', async () => {
    await plugin.execute('dodaj bridge mqtt ws://broker:9001 home/#', browserCtx);
    await plugin.execute('bridge ws wss://echo.websocket.events', browserCtx);
    await plugin.dispose();
    const result = await plugin.execute('lista bridge', browserCtx);
    expect(result.content[0].data).toContain('Brak skonfigurowanych');
  });
});
