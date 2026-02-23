import { describe, it, expect } from 'vitest';
import {
  ACTION_SCHEMAS,
  getSchemasByDomain,
  getAllDomains,
  scoreMatch,
  findMatchingSchemas,
  findDomainSchemas,
  schemasToConfigActions,
  schemasToLlmContext,
} from './actionSchema';

describe('actionSchema', () => {
  describe('ACTION_SCHEMAS', () => {
    it('should contain schemas for all major domains', () => {
      const domains = getAllDomains();
      expect(domains).toContain('camera');
      expect(domains).toContain('network');
      expect(domains).toContain('system');
      expect(domains).toContain('browse');
      expect(domains).toContain('monitor');
    });

    it('each schema has required fields', () => {
      for (const schema of ACTION_SCHEMAS) {
        expect(schema.intent).toBeTruthy();
        expect(schema.domain).toBeTruthy();
        expect(schema.label).toBeTruthy();
        expect(schema.description).toBeTruthy();
        expect(schema.icon).toBeTruthy();
        expect(schema.keywords.length).toBeGreaterThan(0);
        expect(schema.examples.length).toBeGreaterThan(0);
        expect(schema.executeQuery).toBeTruthy();
      }
    });
  });

  describe('getSchemasByDomain', () => {
    it('returns camera schemas', () => {
      const schemas = getSchemasByDomain('camera');
      expect(schemas.length).toBeGreaterThan(0);
      expect(schemas.every(s => s.domain === 'camera')).toBe(true);
    });

    it('returns network schemas', () => {
      const schemas = getSchemasByDomain('network');
      expect(schemas.length).toBeGreaterThan(0);
      expect(schemas.every(s => s.domain === 'network')).toBe(true);
    });
  });

  describe('scoreMatch', () => {
    it('scores camera query against camera schema higher', () => {
      const cameraSchema = ACTION_SCHEMAS.find(s => s.intent === 'camera:snapshot')!;
      const networkSchema = ACTION_SCHEMAS.find(s => s.intent === 'network:scan')!;

      const cameraScore = scoreMatch('zrób zdjęcie z kamery', cameraSchema);
      const networkScore = scoreMatch('zrób zdjęcie z kamery', networkSchema);
      expect(cameraScore).toBeGreaterThan(networkScore);
    });

    it('scores network query against network schema higher', () => {
      const networkSchema = ACTION_SCHEMAS.find(s => s.intent === 'network:scan')!;
      const cameraSchema = ACTION_SCHEMAS.find(s => s.intent === 'camera:snapshot')!;

      const networkScore = scoreMatch('skanuj sieć', networkSchema);
      const cameraScore = scoreMatch('skanuj sieć', cameraSchema);
      expect(networkScore).toBeGreaterThan(cameraScore);
    });

    it('returns 0 for completely unrelated query', () => {
      const schema = ACTION_SCHEMAS.find(s => s.intent === 'camera:ptz')!;
      const score = scoreMatch('jaka jest pogoda', schema);
      expect(score).toBe(0);
    });
  });

  describe('findMatchingSchemas', () => {
    it('finds camera schemas for "użyj kamery"', () => {
      const results = findMatchingSchemas('użyj kamery');
      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.domain === 'camera')).toBe(true);
    });

    it('finds network schemas for "skanuj sieć"', () => {
      const results = findMatchingSchemas('skanuj sieć');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].domain).toBe('network');
    });

    it('respects limit parameter', () => {
      const results = findMatchingSchemas('kamera sieć', 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('returns empty for completely unrelated query', () => {
      const results = findMatchingSchemas('xyzzy foobar 12345');
      expect(results.length).toBe(0);
    });
  });

  describe('findDomainSchemas', () => {
    it('detects camera domain from "użyj kamery"', () => {
      const schemas = findDomainSchemas('użyj kamery');
      expect(schemas.length).toBeGreaterThan(0);
      expect(schemas.every(s => s.domain === 'camera')).toBe(true);
    });

    it('detects network domain from "sprawdź sieć"', () => {
      const schemas = findDomainSchemas('sprawdź sieć');
      expect(schemas.length).toBeGreaterThan(0);
      expect(schemas.every(s => s.domain === 'network')).toBe(true);
    });

    it('detects multiple domains from "kamera w sieci"', () => {
      const schemas = findDomainSchemas('kamera w sieci');
      const domains = new Set(schemas.map(s => s.domain));
      expect(domains.size).toBeGreaterThanOrEqual(2);
    });

    it('returns empty for unknown domain', () => {
      const schemas = findDomainSchemas('xyzzy');
      expect(schemas.length).toBe(0);
    });
  });

  describe('schemasToConfigActions', () => {
    it('converts schemas to ConfigAction format', () => {
      const schemas = getSchemasByDomain('camera').slice(0, 2);
      const actions = schemasToConfigActions(schemas);

      expect(actions.length).toBe(2);
      for (const action of actions) {
        expect(action.id).toMatch(/^action-/);
        expect(action.label).toBeTruthy();
        expect(action.type).toBe('execute');
        expect(action.executeQuery).toBeTruthy();
        expect(action.variant).toBe('primary');
      }
    });
  });

  describe('schemasToLlmContext', () => {
    it('generates readable LLM context with domain headings', () => {
      const schemas = getSchemasByDomain('camera');
      const context = schemasToLlmContext(schemas);

      expect(context).toContain('## Kamery');
      expect(context).toContain('camera:');
      expect(context).toContain('Przykłady:');
    });

    it('groups multiple domains', () => {
      const schemas = [...getSchemasByDomain('camera'), ...getSchemasByDomain('network')];
      const context = schemasToLlmContext(schemas);

      expect(context).toContain('## Kamery');
      expect(context).toContain('## Sieć');
    });
  });
});
