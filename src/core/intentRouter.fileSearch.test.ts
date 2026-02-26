import { describe, it, expect, beforeEach } from 'vitest';
import { IntentRouter } from './intentRouter';

describe('IntentRouter - file:search intent detection', () => {
  let router: IntentRouter;

  beforeEach(() => {
    router = new IntentRouter();
  });

  it('detects "lista plików w folderze usera" as file:search', async () => {
    const result = await router.detect('lista plików w folderze usera');
    expect(result.intent).toBe('file:search');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('detects "lista wszystkich plików" as file:search', async () => {
    const result = await router.detect('lista wszystkich plików');
    expect(result.intent).toBe('file:search');
  });

  it('detects "lista wszystkich plików na dysku" as file:search', async () => {
    const result = await router.detect('lista wszystkich plików na dysku');
    expect(result.intent).toBe('file:search');
  });

  it('detects "pokaż pliki w katalogu domowym" as file:search', async () => {
    const result = await router.detect('pokaż pliki w katalogu domowym');
    expect(result.intent).toBe('file:search');
  });

  it('detects "co jest w folderze usera" as file:search', async () => {
    const result = await router.detect('co jest w folderze usera');
    expect(result.intent).toBe('file:search');
  });

  it('detects "ls ~" as file:search', async () => {
    const result = await router.detect('ls ~');
    expect(result.intent).toBe('file:search');
  });

  it('detects "zawartość folderu domowego" as file:search', async () => {
    const result = await router.detect('zawartość folderu domowego');
    expect(result.intent).toBe('file:search');
  });

  it('detects "wylistuj pliki" as file:search', async () => {
    const result = await router.detect('wylistuj pliki');
    expect(result.intent).toBe('file:search');
  });

  it('detects "pliki użytkownika" as file:search', async () => {
    const result = await router.detect('pliki użytkownika');
    expect(result.intent).toBe('file:search');
  });

  it('detects "list files in home directory" as file:search', async () => {
    const result = await router.detect('list files in home directory');
    expect(result.intent).toBe('file:search');
  });

  it('detects "znajdz faktury" as file:search', async () => {
    const result = await router.detect('znajdz faktury');
    expect(result.intent).toBe('file:search');
  });
});
