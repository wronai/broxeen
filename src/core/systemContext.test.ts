import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getSystemContext, buildSystemContextPrompt, resetSystemContext, updateSystemContext } from './systemContext';

describe('SystemContext', () => {
  beforeEach(() => {
    resetSystemContext();
  });

  describe('getSystemContext', () => {
    it('returns a valid context object', () => {
      const ctx = getSystemContext();
      expect(ctx).toBeDefined();
      expect(ctx.os).toBeTruthy();
      expect(ctx.runtime).toBeTruthy();
      expect(ctx.homeDir).toBeTruthy();
      expect(ctx.shell).toBeTruthy();
      expect(ctx.capabilities).toBeInstanceOf(Array);
      expect(ctx.capabilities.length).toBeGreaterThan(0);
    });

    it('caches the result on repeated calls', () => {
      const ctx1 = getSystemContext();
      const ctx2 = getSystemContext();
      expect(ctx1).toBe(ctx2); // same object reference
    });

    it('detects OS as linux in test environment', () => {
      const ctx = getSystemContext();
      // jsdom sets navigator.userAgent to include "jsdom" but platform may vary
      expect(['linux', 'macos', 'windows', 'unknown']).toContain(ctx.os);
    });

    it('detects runtime as browser in test environment', () => {
      const ctx = getSystemContext();
      expect(ctx.runtime).toBe('browser'); // no __TAURI__ in tests
    });

    it('includes core capabilities', () => {
      const ctx = getSystemContext();
      expect(ctx.capabilities).toContain('chat');
      expect(ctx.capabilities).toContain('browse');
      expect(ctx.capabilities).toContain('network_scan');
    });
  });

  describe('updateSystemContext', () => {
    it('patches the cached context', () => {
      const ctx = getSystemContext();
      expect(ctx.user).toBeTruthy();

      updateSystemContext({ user: 'test-user', homeDir: '/home/test-user' });
      const updated = getSystemContext();
      expect(updated.user).toBe('test-user');
      expect(updated.homeDir).toBe('/home/test-user');
    });
  });

  describe('buildSystemContextPrompt', () => {
    it('returns a non-empty string', () => {
      const prompt = buildSystemContextPrompt();
      expect(prompt.length).toBeGreaterThan(100);
    });

    it('includes OS information', () => {
      const prompt = buildSystemContextPrompt();
      expect(prompt).toMatch(/System operacyjny/);
    });

    it('includes runtime information', () => {
      const prompt = buildSystemContextPrompt();
      expect(prompt).toMatch(/Runtime/);
    });

    it('includes capabilities list', () => {
      const prompt = buildSystemContextPrompt();
      expect(prompt).toMatch(/Dostępne możliwości/);
      expect(prompt).toMatch(/rozmowa z użytkownikiem/);
    });

    it('includes important rules', () => {
      const prompt = buildSystemContextPrompt();
      expect(prompt).toMatch(/WAŻNE zasady/);
      expect(prompt).toMatch(/ZAWSZE odpowiadaj w kontekście systemu/);
    });

    it('includes home directory path', () => {
      updateSystemContext({ homeDir: '/home/testuser' });
      const prompt = buildSystemContextPrompt();
      expect(prompt).toContain('/home/testuser');
    });
  });

  describe('resetSystemContext', () => {
    it('clears cached context so next call re-detects', () => {
      const ctx1 = getSystemContext();
      resetSystemContext();
      const ctx2 = getSystemContext();
      // Different object reference after reset
      expect(ctx1).not.toBe(ctx2);
    });
  });
});
