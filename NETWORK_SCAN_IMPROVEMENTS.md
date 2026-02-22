# Network Scan Improvements - Browser Mode

## Problem
Browser-mode network scanning wykrywało 0 hostów z powodu ograniczeń przeglądarki:
- CORS blokuje requesty HTTP do LAN IPs
- Mixed-content policy blokuje HTTP z HTTPS
- Timing gate (>50ms) był zbyt wysoki dla szybkich hostów

## Rozwiązanie

### 1. Ulepszone strategie wykrywania hostów

#### Strategia A: Image Probe (istniejąca, ulepszona)
```typescript
const img = new Image();
img.onload = () => done('img-load');
img.onerror = () => {
  if (Date.now() - t0 > TIMING_THRESHOLD_MS) {
    done('img-timing');
  }
};
img.src = `http://${ip}:${port}/?_probe=${Date.now()}`;
```

#### Strategia B: no-cors Fetch (istniejąca)
```typescript
fetch(`http://${ip}:${port}/`, {
  method: 'HEAD', 
  mode: 'no-cors',
  signal: AbortSignal.timeout(2000),
}).then(() => done('fetch-ok'));
```

#### Strategia C: WebSocket Probe (NOWA)
```typescript
const ws = new WebSocket(`ws://${ip}:${port}/`);
ws.onopen = () => done('ws-open');
ws.onerror = () => {
  if (Date.now() - t0 > TIMING_THRESHOLD_MS) {
    done('ws-timing');
  }
};
```

### 2. Zmiany techniczne

| Parametr | Przed | Po | Uzasadnienie |
|----------|-------|-----|--------------|
| Timing threshold | 50ms | 15ms | Szybsze hosty w LAN odpowiadają <20ms |
| Probe timeout | 1500ms | 2500ms | Więcej czasu na TCP handshake |
| Porty dla kamer | [80, 8080, 8000, 8888] | [80, 8080, 8000, 8888, 8554, 81] | Dodano RTSP (8554) i alternatywny HTTP (81) |
| Batch size | 15 | 10 | Mniejsze batche = mniej przeciążenia |

### 3. Lepszy output przy 0 wynikach

Zamiast:
```
Nie wykryto urządzeń w sieci.
```

Teraz:
```
Nie wykryto urządzeń w sieci.

**Możliwe przyczyny:**
- Przeglądarka blokuje skanowanie LAN (CORS/mixed-content)
- Urządzenia są w innej podsieci
- Twój adres IP: 192.168.0.123

💡 **Co możesz zrobić:**

**1. Podaj IP kamery bezpośrednio:**
- "monitoruj 192.168.0.100" — sprawdź konkretny adres
- "ping 192.168.0.1" — sprawdź gateway

**2. Sprawdź router:**
- Otwórz panel routera: `http://192.168.0.1`
- Lista DHCP pokaże wszystkie urządzenia w sieci

**3. Uruchom Tauri:**
- Pełne skanowanie TCP/ARP/ONVIF bez ograniczeń przeglądarki

---
💡 **Sugerowane akcje:**
- "monitoruj 192.168.0.100" — Sprawdź typowy IP kamery
- "ping 192.168.0.1" — Sprawdź gateway
- "skanuj porty 192.168.0.1" — Porty routera
- "bridge rest GET http://192.168.0.1" — Pobierz stronę routera
```

## Inline Action Hints w Chat.tsx

### Funkcjonalność
Linie w formacie `- "komenda" — opis` są automatycznie parsowane i renderowane jako klikalne przyciski.

### Implementacja
```typescript
{msg.role === "assistant" && !msg.loading && (() => {
  const hintPattern = /^-\s*"([^"]+)"\s*[—–-]\s*(.+)$/gm;
  const hints: Array<{query: string; label: string}> = [];
  let m;
  while ((m = hintPattern.exec(msg.text)) !== null) {
    hints.push({ query: m[1], label: m[2].trim() });
  }
  if (hints.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {hints.map((hint, i) => (
        <button onClick={() => handleSubmit(hint.query)}>
          ⚡ {hint.label}
        </button>
      ))}
    </div>
  );
})()}
```

### Przykład użycia
Plugin zwraca:
```
- "monitoruj 192.168.0.100" — Sprawdź typowy IP kamery
- "ping 192.168.0.1" — Sprawdź gateway
```

Chat renderuje:
```
[⚡ Sprawdź typowy IP kamery] [⚡ Sprawdź gateway]
```

## Bezpośrednie monitorowanie IP

MonitorPlugin już obsługuje bezpośrednie IP:
```typescript
// Użytkownik pisze:
monitoruj 192.168.0.100

// Plugin parsuje IP i startuje monitoring:
private parseTarget(input: string) {
  const ipMatch = input.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  if (ipMatch) {
    return {
      id: `device-${ipMatch[0]}`,
      type: 'device',
      name: `Urządzenie ${ipMatch[0]}`,
      address: ipMatch[0],
      intervalMs, threshold,
    };
  }
}
```

## Testy
✅ Wszystkie testy przechodzą: **27 plików, 469 testów**

## Użycie

### Skanowanie sieci (browser mode)
```
pokaż kamery
```

### Jeśli 0 wyników → kliknij sugerowaną akcję
```
[⚡ Sprawdź typowy IP kamery] → wykonuje "monitoruj 192.168.0.100"
```

### Bezpośrednie monitorowanie
```
monitoruj 192.168.0.100 co 30s
```

## Ograniczenia browser mode
- Nie może wykonać prawdziwego TCP SYN scan
- Nie ma dostępu do ARP
- CORS/mixed-content blokują wiele requestów
- Timing gate nie jest w 100% niezawodny

**Rozwiązanie:** Uruchom aplikację Tauri dla pełnego skanowania TCP/ARP/ONVIF.
