# Inline Action Hints dla wyników skanowania kamer

## Problem

Po skanowaniu kamer wyniki pokazywały tylko tekst informacyjny, bez **klikalnych przycisków** (action hints):

```
📷 **Wyszukiwanie kamer zakończone**

1. **192.168.188.146** *(camera)*
   Hostname: Camera4.nasze.de
   Porty: 80, 443, 554, 8000, 9000
   📷 RTSP: `rtsp://192.168.188.146:554/stream`

💡 *Zapytaj "pokaż kamerę [IP]" aby zobaczyć obraz lub "skanuj porty [IP]" dla szczegółów.*
```

**Brak przycisków!** Użytkownik musiał ręcznie wpisywać komendy.

## Rozwiązanie

Dodano sekcję **💡 Sugerowane akcje:** w formacie rozpoznawanym przez `Chat.tsx`, który automatycznie renderuje je jako klikalne przyciski.

### Format inline action hints

```markdown
💡 **Sugerowane akcje:**
- "komenda" — Opis akcji
```

**Wzorzec regex w Chat.tsx:**
```typescript
const hintPattern = /^-\s*"([^"]+)"\s*[—–-]\s*(.+)$/gm;
```

## Implementacja

### Przed (brak przycisków)

```typescript
content += `💡 *Zapytaj "pokaż kamerę [IP]" aby zobaczyć obraz lub "skanuj porty [IP]" dla szczegółów.*`;
```

### Po (z przyciskami)

```typescript
// Add inline action hints for cameras
if (isCameraQuery && devicesToShow.length > 0) {
  content += `\n💡 **Sugerowane akcje:**\n`;
  devicesToShow.forEach(device => {
    const hasRtsp = device.open_ports.includes(554) || device.open_ports.includes(8554);
    const hasHttp = device.open_ports.includes(80) || device.open_ports.includes(8000);
    
    if (hasRtsp) {
      content += `- "monitoruj ${device.ip}" — Rozpocznij monitoring kamery\n`;
    }
    if (hasHttp) {
      const httpPort = device.open_ports.includes(80) ? 80 : 8000;
      content += `- "przeglądaj http://${device.ip}:${httpPort}" — Otwórz interfejs web\n`;
    }
    content += `- "skanuj porty ${device.ip}" — Zaawansowana analiza portów i producenta\n`;
  });
}
```

## Wynik

### Dla kamery z RTSP + HTTP (192.168.188.146)

```
📷 **Wyszukiwanie kamer zakończone**

1. **192.168.188.146** *(camera)*
   Hostname: Camera4.nasze.de
   Porty: 80, 443, 554, 8000, 9000
   📷 RTSP: `rtsp://192.168.188.146:554/stream`

💡 **Sugerowane akcje:**
- "monitoruj 192.168.188.146" — Rozpocznij monitoring kamery
- "przeglądaj http://192.168.188.146:80" — Otwórz interfejs web
- "skanuj porty 192.168.188.146" — Zaawansowana analiza portów i producenta
```

**Renderowane jako:**

```
[⚡ Rozpocznij monitoring kamery]  ← klikalny przycisk
[🌐 Otwórz interfejs web]          ← klikalny przycisk
[🔍 Zaawansowana analiza portów]   ← klikalny przycisk
```

### Dla kamery tylko z RTSP (bez HTTP)

```
💡 **Sugerowane akcje:**
- "monitoruj 192.168.188.200" — Rozpocznij monitoring kamery
- "skanuj porty 192.168.188.200" — Zaawansowana analiza portów i producenta
```

### Dla kamery tylko z HTTP (bez RTSP)

```
💡 **Sugerowane akcje:**
- "przeglądaj http://192.168.188.1:80" — Otwórz interfejs web
- "skanuj porty 192.168.188.1" — Zaawansowana analiza portów i producenta
```

## Logika generowania przycisków

```typescript
const hasRtsp = device.open_ports.includes(554) || device.open_ports.includes(8554);
const hasHttp = device.open_ports.includes(80) || device.open_ports.includes(8000);

if (hasRtsp) {
  // Przycisk "monitoruj" - tylko dla kamer z RTSP
  content += `- "monitoruj ${device.ip}" — Rozpocznij monitoring kamery\n`;
}

if (hasHttp) {
  // Przycisk "przeglądaj" - tylko dla urządzeń z HTTP
  const httpPort = device.open_ports.includes(80) ? 80 : 8000;
  content += `- "przeglądaj http://${device.ip}:${httpPort}" — Otwórz interfejs web\n`;
}

// Przycisk "skanuj porty" - zawsze dostępny
content += `- "skanuj porty ${device.ip}" — Zaawansowana analiza portów i producenta\n`;
```

## Dostępne akcje

### 1. Monitoruj kamerę (RTSP)

**Warunek:** Port 554 lub 8554 otwarty

**Komenda:** `monitoruj 192.168.188.146`

**Efekt:**
- Rozpoczyna monitoring kamery w czasie rzeczywistym
- Pobiera snapshot co X sekund
- Analizuje zmiany przez AI
- Wysyła powiadomienia o wykrytych zdarzeniach

### 2. Otwórz interfejs web (HTTP)

**Warunek:** Port 80 lub 8000 otwarty

**Komenda:** `przeglądaj http://192.168.188.146:80`

**Efekt:**
- Otwiera interfejs webowy kamery
- Pozwala na konfigurację ustawień
- Dostęp do live view
- Zarządzanie nagraniami

### 3. Zaawansowana analiza portów

**Warunek:** Zawsze dostępne

**Komenda:** `skanuj porty 192.168.188.146`

**Efekt:**
- Skanuje wszystkie 25 portów kamery
- Identyfikuje producenta (Hikvision, Dahua, etc.)
- Podaje domyślne hasła
- Generuje RTSP URLs specyficzne dla producenta
- Wykrywa metody autoryzacji
- Pokazuje funkcje kamery (ONVIF, P2P, AI)

## Przykład pełnego wyniku

```
📷 **Wyszukiwanie kamer zakończone**

Metoda: tcp-connect-parallel
Czas trwania: 3626ms
Znaleziono urządzeń: 5

**Znalezione kamery:**

1. **192.168.188.146** *(camera)*
   Hostname: Camera4.nasze.de
   MAC: `ec:71:db:f8:9f:fb`
   Porty: 80, 443, 554, 8000, 9000
   RTT: 4ms
   📷 RTSP: `rtsp://192.168.188.146:554/stream`

2. **192.168.188.200** *(camera)*
   Hostname: Camera-Dahua
   MAC: `aa:bb:cc:dd:ee:ff`
   Porty: 80, 554
   RTT: 6ms
   📷 RTSP: `rtsp://192.168.188.200:554/stream`

3. **192.168.188.1** *(router)*
   Hostname: Router.local
   Porty: 80, 443
   RTT: 2ms

💡 **Sugerowane akcje:**
- "monitoruj 192.168.188.146" — Rozpocznij monitoring kamery
- "przeglądaj http://192.168.188.146:80" — Otwórz interfejs web
- "skanuj porty 192.168.188.146" — Zaawansowana analiza portów i producenta
- "monitoruj 192.168.188.200" — Rozpocznij monitoring kamery
- "przeglądaj http://192.168.188.200:80" — Otwórz interfejs web
- "skanuj porty 192.168.188.200" — Zaawansowana analiza portów i producenta
- "przeglądaj http://192.168.188.1:80" — Otwórz interfejs web
- "skanuj porty 192.168.188.1" — Zaawansowana analiza portów i producenta
```

## Renderowanie w Chat.tsx

**Kod parsujący:**
```typescript
{msg.role === "assistant" && !msg.loading && (() => {
  const markers = [
    '💡 **Sugerowane akcje:**',
    '💡 **Komendy:**',
    '💡 Komendy:',
    '💡 Komendy'
  ];

  let markerIdx = -1;
  let markerText = '';
  for (const candidate of markers) {
    const idx = msg.text.indexOf(candidate);
    if (idx !== -1) {
      markerIdx = idx;
      markerText = candidate;
      break;
    }
  }

  if (markerIdx === -1) return null;

  const afterMarker = msg.text.slice(markerIdx + markerText.length);
  const section = afterMarker.split('\n').map((l) => l.trimEnd()).join('\n');

  const hintPattern = /^-\s*"([^"]+)"\s*[—–-]\s*(.+)$/gm;
  const hints: Array<{ command: string; label: string }> = [];
  let match;
  while ((match = hintPattern.exec(section)) !== null) {
    hints.push({ command: match[1], label: match[2] });
  }

  if (hints.length === 0) return null;

  return (
    <ActionSuggestions
      suggestions={hints}
      onSelect={(cmd) => handleSubmit(cmd)}
    />
  );
})()}
```

**Renderowane jako:**
```tsx
<ActionSuggestions
  suggestions={[
    { command: "monitoruj 192.168.188.146", label: "Rozpocznij monitoring kamery" },
    { command: "przeglądaj http://192.168.188.146:80", label: "Otwórz interfejs web" },
    { command: "skanuj porty 192.168.188.146", label: "Zaawansowana analiza portów i producenta" },
  ]}
  onSelect={(cmd) => handleSubmit(cmd)}
/>
```

## Integracja z innymi pluginami

### AdvancedPortScanPlugin

Również generuje inline action hints:

```typescript
lines.push(`\n---`);
lines.push(`💡 **Sugerowane akcje:**`);
lines.push(`- "monitoruj ${result.ip}" — Rozpocznij monitorowanie`);
if (result.httpUrls.length > 0) {
  lines.push(`- "przeglądaj ${result.httpUrls[0]}" — Otwórz interfejs web`);
}
```

### MonitorPlugin

Może również generować action hints po zakończeniu monitoringu:

```typescript
💡 **Sugerowane akcje:**
- "pokaż snapshot 192.168.188.146" — Zobacz ostatni obraz
- "zatrzymaj monitoring 192.168.188.146" — Zatrzymaj monitoring
- "pobierz nagranie 192.168.188.146" — Pobierz nagranie
```

## Podsumowanie

✅ **Dodano inline action hints** do wyników skanowania kamer  
✅ **3 typy przycisków** - monitoruj, przeglądaj, skanuj porty  
✅ **Inteligentne generowanie** - tylko dostępne akcje (RTSP/HTTP)  
✅ **Kompatybilność** - działa z istniejącym systemem Chat.tsx  
✅ **Testy przechodzą** - 33 pliki, 532 testy ✅  

**Teraz każde skanowanie kamer będzie miało klikalne przyciski akcji!** 🎉
