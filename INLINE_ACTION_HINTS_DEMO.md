# Inline Action Hints - Demonstracja

## Jak to działa

### 1. Plugin zwraca tekst z sugestiami
```typescript
// networkScanPlugin.ts - gdy 0 hostów znaleziono
lines.push('💡 **Sugerowane akcje:**');
lines.push(`- "monitoruj ${subnet}.100" — Sprawdź typowy IP kamery`);
lines.push(`- "ping ${subnet}.1" — Sprawdź gateway`);
lines.push(`- "skanuj porty ${subnet}.1" — Porty routera`);
lines.push(`- "bridge rest GET http://${gatewayIp}" — Pobierz stronę routera`);
```

### 2. Chat.tsx automatycznie parsuje i renderuje przyciski
```typescript
// Pattern: - "komenda" — opis
const hintPattern = /^-\s*"([^"]+)"(?:\s*[—–-]\s*(.+))?$/gm;

// Dla każdego dopasowania tworzy przycisk.
// Jeśli komenda wygląda na szablon (HASŁO / PASSWORD / USER / USERNAME / NAZWA),
// przycisk prefilluje input zamiast wykonywać od razu.
// Maksymalnie renderuje 10 przycisków.
```

### 3. Użytkownik klika przycisk → komenda wykonuje się automatycznie

## Przykłady użycia

### Przykład 1: Network Scan (0 wyników)

**Wejście użytkownika:**
```
pokaż kamery
```

**Odpowiedź asystenta:**
```
📷 **Wyszukiwanie kamer** *(tryb przeglądarkowy)*

🌐 **Podsieć:** 192.168.0.0/24 *(wykryta: gateway-probe)*
Przeskanowano: 30 adresów IP
Znaleziono: 0 aktywnych hostów

Nie wykryto urządzeń w sieci.

**Możliwe przyczyny:**
- Przeglądarka blokuje skanowanie LAN (CORS/mixed-content)
- Urządzenia są w innej podsieci
- Twój adres IP: nie wykryto

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

**Renderowane przyciski:**
```
┌─────────────────────────────────────┐
│ ⚡ Sprawdź typowy IP kamery         │
├─────────────────────────────────────┤
│ ⚡ Sprawdź gateway                   │
├─────────────────────────────────────┤
│ ⚡ Porty routera                     │
├─────────────────────────────────────┤
│ ⚡ Pobierz stronę routera            │
└─────────────────────────────────────┘
```

**Kliknięcie "⚡ Sprawdź typowy IP kamery":**
- Automatycznie wykonuje: `monitoruj 192.168.0.100`
- MonitorPlugin startuje monitoring tego IP
- Użytkownik otrzymuje potwierdzenie z logami

### Przykład 2: Protocol Bridge (MQTT)

**Plugin może zwracać:**
```
✅ **MQTT połączenie nawiązane**

Broker: mqtt://192.168.0.50:1883
Status: Connected

💡 **Sugerowane akcje:**
- "bridge mqtt SUB home/temperature" — Subskrybuj temperaturę
- "bridge mqtt PUB home/light ON" — Włącz światło
- "bridge mqtt status" — Sprawdź status połączenia
```

**Renderowane przyciski:**
```
┌─────────────────────────────────────┐
│ ⚡ Subskrybuj temperaturę            │
├─────────────────────────────────────┤
│ ⚡ Włącz światło                     │
├─────────────────────────────────────┤
│ ⚡ Sprawdź status połączenia         │
└─────────────────────────────────────┘
```

### Przykład 3: Monitor Plugin

**Plugin może zwracać:**
```
✅ **Monitoring uruchomiony**

📌 **Cel:** Urządzenie 192.168.0.100
📍 **Typ:** device
🌐 **Adres:** 192.168.0.100
⏱️ **Interwał:** co 30s
📊 **Próg zmian:** 15%

Zmiany będą automatycznie zgłaszane w tym czacie.

💡 Komendy:
- "pokaż logi monitoringu Urządzenie 192.168.0.100" — Zobacz historię
- "stop monitoring Urządzenie 192.168.0.100" — Zatrzymaj
- "aktywne monitoringi" — Lista wszystkich
```

**Renderowane przyciski:**
```
┌─────────────────────────────────────┐
│ ⚡ Zobacz historię                   │
├─────────────────────────────────────┤
│ ⚡ Zatrzymaj                         │
├─────────────────────────────────────┤
│ ⚡ Lista wszystkich                  │
└─────────────────────────────────────┘
```

## Format action hints

### Wymagany format w tekście pluginu:
```
- "pełna_komenda" — Krótki opis dla użytkownika
```

### Obsługiwane separatory:
- `—` (em dash, Unicode U+2014)
- `–` (en dash, Unicode U+2013)
- `-` (hyphen, ASCII)

### Regex pattern:
```typescript
/^-\s*"([^"]+)"(?:\s*[—–-]\s*(.+))?$/gm
```

### Przykłady poprawnych formatów:
```
- "monitoruj 192.168.0.100" — Sprawdź kamerę
- "ping 192.168.0.1" – Sprawdź gateway
- "bridge mqtt status" - Status MQTT
```

### Przykłady niepoprawnych formatów (nie będą parsowane):
```
- monitoruj 192.168.0.100 — Brak cudzysłowów
* "monitoruj 192.168.0.100" — Zły znak listy
- "monitoruj 192.168.0.100" Brak separatora
```

## Integracja z pluginami

### Każdy plugin może dodawać action hints:

```typescript
// W metodzie execute() pluginu:
const lines = [
  '✅ Operacja zakończona',
  '',
  '💡 **Sugerowane akcje:**',
  `- "następna_komenda" — Opis akcji`,
  `- "inna_komenda" — Inny opis`,
];

return {
  pluginId: this.id,
  status: 'success',
  content: [{ type: 'text', data: lines.join('\n') }],
  metadata: { ... }
};
```

### Chat.tsx automatycznie:
1. Wykrywa pattern w `msg.text`
2. Ekstrahuje komendy i opisy
3. Renderuje jako klikalne przyciski
4. Wykonuje komendę po kliknięciu

## Korzyści

### Dla użytkownika:
- ✅ Nie musi pamiętać składni komend
- ✅ Jeden klik zamiast pisania
- ✅ Kontekstowe sugestie (zależne od sytuacji)
- ✅ Szybsze workflow

### Dla deweloperów pluginów:
- ✅ Prosty format tekstowy
- ✅ Nie wymaga zmian w API pluginu
- ✅ Działa z istniejącymi pluginami
- ✅ Automatyczne parsowanie w Chat.tsx

## Styling

Przyciski używają kolorów Broxeen:
```css
bg-broxeen-600/20        /* Tło z 20% opacity */
border-broxeen-600/30    /* Border z 30% opacity */
text-broxeen-300         /* Tekst */
hover:bg-broxeen-600/30  /* Hover efekt */
```

Ikona: ⚡ (Zap z lucide-react, 12px)

## Testy

Dodaj test dla action hints:
```typescript
it('renders action hints from assistant message', () => {
  const message = {
    role: 'assistant',
    text: '- "test command" — Test description',
    loading: false
  };
  
  render(<Chat />);
  
  const hint = screen.getByTestId('action-hints');
  expect(hint).toBeInTheDocument();
  expect(hint).toHaveTextContent('Test description');
});
```
