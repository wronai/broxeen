# Quick Start - Skanowanie sieci i monitorowanie kamer

## 🚀 Szybki start

### 1. Skanowanie sieci w poszukiwaniu kamer

**W przeglądarce:**
```
pokaż kamery
```

**Wynik:**
- Automatyczne wykrywanie podsieci (WebRTC lub gateway probe)
- Skanowanie ~30 najczęstszych adresów IP dla kamer
- Wykrywanie portów: 80, 8080, 8000, 8888, 8554, 81
- Identyfikacja RTSP (port 554)

**Jeśli 0 wyników:**
- System pokaże **klikalne sugestie** ⚡
- Kliknij przycisk zamiast pisać komendę
- Automatyczne wykonanie akcji

### 2. Bezpośrednie monitorowanie kamery (znasz IP)

**Komenda:**
```
monitoruj 192.168.0.100
```

**Opcje:**
```
monitoruj 192.168.0.100 co 30s          # Custom interwał
monitoruj 192.168.0.100 próg 20%        # Custom próg zmian
monitoruj 192.168.0.100 co 60s próg 10% # Oba parametry
```

**Wynik:**
```
✅ Monitoring uruchomiony

📌 Cel: Urządzenie 192.168.0.100
⏱️ Interwał: co 30s
📊 Próg zmian: 15%

[⚡ Zobacz historię] [⚡ Zatrzymaj] [⚡ Lista wszystkich]
```

### 3. Zarządzanie monitoringiem

**Pokaż aktywne:**
```
aktywne monitoringi
```

**Zatrzymaj:**
```
stop monitoring 192.168.0.100
```

**Zobacz logi:**
```
pokaż logi monitoringu 192.168.0.100
```

### 4. Status i filtrowanie urządzeń (Tauri + SQLite)

Jeśli aplikacja działa w trybie desktop (Tauri) i masz włączoną persystencję urządzeń w SQLite, możesz wyświetlić listę znanych urządzeń oraz filtrować je po typie.

**Status / lista urządzeń:**
```
status urządzeń
lista urządzeń
znane urządzenia
pokaż urządzenia
```

**Filtrowanie po typie:**
```
tylko kamery
tylko routery
tylko drukarki
filtruj urządzenia
```

## 💡 Inline Action Hints - Jak działają?

### Automatyczne sugestie
System automatycznie wykrywa sugestie w odpowiedziach i renderuje je jako przyciski:

Od teraz surowa lista `- "..." — ...` nie jest pokazywana w treści wiadomości (markdown) — `Chat.tsx` ucina tekst w miejscu markera `Sugerowane akcje` i pokazuje przyciski pod spodem.

**Format w tekście:**
```
- "komenda" — Opis akcji
```

**Renderowane jako:**
```
┌─────────────────────────┐
│ ⚡ Opis akcji           │
└─────────────────────────┘
```

### Przykłady

#### Skanowanie (0 wyników)
```
💡 Sugerowane akcje:
- "monitoruj 192.168.0.100" — Sprawdź typowy IP kamery
- "ping 192.168.0.1" — Sprawdź gateway
- "skanuj porty 192.168.0.1" — Porty routera
```

**Kliknij dowolny przycisk → komenda wykonuje się automatycznie**

#### Monitoring aktywny
```
💡 Komendy:
- "pokaż logi monitoringu Kamera wejściowa" — Zobacz historię
- "stop monitoring Kamera wejściowa" — Zatrzymaj
- "aktywne monitoringi" — Lista wszystkich
```

#### Kamera znaleziona w skanie
Przykładowe przyciski generowane dla kamery (z RTSP):
```
💡 **Sugerowane akcje:**
- "pokaż live 192.168.0.100" — Podgląd na żywo z kamery
- "monitoruj 192.168.0.100" — Rozpocznij monitoring kamery
- "pokaż logi monitoringu 192.168.0.100" — Logi zmian dla tej kamery
- "stop monitoring 192.168.0.100" — Zatrzymaj monitoring tej kamery
- "ustaw próg zmian 10%" — Większa czułość (globalnie)
- "zmień interwał co 10s" — Częstsze sprawdzanie (globalnie)
- "jak działa monitoring" — Wyjaśnij pipeline i diagnostykę
- "test streams 192.168.0.100 user:admin admin:HASŁO" — Sprawdź warianty RTSP
```

#### Protocol Bridge
```
💡 Sugerowane akcje:
- "bridge mqtt SUB home/temperature" — Subskrybuj temperaturę
- "bridge mqtt PUB home/light ON" — Włącz światło
- "bridge mqtt status" — Sprawdź status połączenia
```

## 🔍 Skanowanie sieci - Szczegóły

### Tryb przeglądarkowy (browser mode)

**Strategie wykrywania:**
1. **Image Probe** - obejście CORS przez `<img>` tag
2. **no-cors Fetch** - opaque response = host żywy
3. **WebSocket Probe** - TCP handshake timing

**Uwaga o snapshotach HTTP (CORS):**
Jeśli snapshot kamery po HTTP jest blokowany przez CORS w przeglądarce, dev-serwer udostępnia proxy:
```
GET /api/camera-proxy?url=http://USER:PASS@192.168.0.10/snapshot.jpg
```

**Wykrywane podsieci:**
- WebRTC ICE candidates (Chrome/Firefox)
- Gateway probe (192.168.1.1, 192.168.0.1, etc.)
- Fallback: `network.defaultSubnet` z konfiguracji (domyślnie 192.168.1, ale może być np. 192.168.188)

**Skanowane IP:**
- Gateway: .1
- Kamery: .100, .101, .102, .103, .108, .110, .150, .200, .201, .250
- Urządzenia: .2, .10, .20, .30, .50, .60, .70, .80, .90, .120, etc.

**Czas skanowania:** ~5-7 sekund

### Tryb Tauri (desktop app)

**Pełne możliwości:**
- ✅ TCP SYN scan
- ✅ ARP discovery
- ✅ ONVIF discovery
- ✅ mDNS/Bonjour
- ✅ Pełny zakres portów
- ✅ Brak ograniczeń CORS (RTSP przez backend)

**Uwaga (DEV / Vite):**
- W trybie development HTTP snapshoty z LAN mogą być blokowane przez CORS po stronie WebView.
- Repo zawiera dev-proxy: `GET /api/camera-proxy?url=http://IP/...` (Vite middleware), używany automatycznie przez monitoring w DEV.

**Tryb incremental (szybsze skany):**
W trybie desktop (Tauri) skaner może działać w trybie `incremental` i skanować tylko wybrane hosty na podstawie historii.
Parametr `target_ranges` przyjmuje listę zakresów last-octet, np. `"100-150"` albo pełne `"192.168.0.100-150"`.

**Uruchom:**
```bash
corepack pnpm tauri dev
```

## 🎯 Przypadki użycia

### Scenariusz 1: Nowa instalacja
```
1. Użytkownik: "pokaż kamery"
2. System: [skanuje sieć]
3. Wynik: 0 kamer (CORS blokuje)
4. System: [pokazuje 4 klikalne sugestie]
5. Użytkownik: [klika "⚡ Sprawdź typowy IP kamery"]
6. System: [wykonuje "monitoruj 192.168.0.100"]
7. Monitoring: [startuje, pokazuje status]
```

### Scenariusz 2: Znane IP
```
1. Użytkownik: "monitoruj 192.168.0.100 co 60s"
2. System: [parsuje IP + interwał]
3. Monitoring: [startuje z custom ustawieniami]
4. System: [pokazuje hints do zarządzania]
```

### Scenariusz 3: Sprawdzanie routera
```
1. Użytkownik: "pokaż kamery"
2. System: [0 wyników]
3. Użytkownik: [klika "⚡ Pobierz stronę routera"]
4. System: [wykonuje "bridge rest GET http://192.168.0.1"]
5. BrowsePlugin: [pobiera stronę routera]
6. System: [pokazuje listę DHCP z routera]
```

## ⚙️ Konfiguracja monitoringu

### Parametry

**Interwał:**
- `co 30s` - co 30 sekund
- `co 5m` - co 5 minut
- Domyślnie: 30s

**Próg zmian:**
- `próg 10%` - wykryj zmiany >10%
- `próg 20%` - wykryj zmiany >20%
- Domyślnie: 15%

### Przykłady

**Szybki monitoring (co 10s, próg 5%):**
```
monitoruj 192.168.0.100 co 10s próg 5%
```

**Wolny monitoring (co 5m, próg 30%):**
```
monitoruj 192.168.0.100 co 5m próg 30%
```

**Monitoring kamery z nazwą:**
```
monitoruj kamerę wejściową co 30s
```

## 🐛 Troubleshooting

### Problem: Skanowanie znajduje 0 hostów

**Przyczyny:**
1. Przeglądarka blokuje CORS
2. Mixed-content policy (HTTPS → HTTP)
3. Urządzenia w innej podsieci
4. Firewall blokuje probe

**Rozwiązania:**
1. **Kliknij sugestię** "⚡ Sprawdź typowy IP kamery"
2. **Podaj IP bezpośrednio:** `monitoruj 192.168.0.100`
3. **Sprawdź router:** kliknij "⚡ Pobierz stronę routera"
4. **Uruchom Tauri:** pełne skanowanie bez ograniczeń

### Problem: `ENOSPC: System limit for number of file watchers reached`

Jeśli `make dev`/Vite pada na `ENOSPC`, zwiększ limity inotify albo użyj dev-konfiguracji z polling (w tym repo jest już ustawione ignorowanie `venv/` i polling watch).

### Problem: Monitoring nie wykrywa zmian

**Sprawdź:**
1. Próg zmian nie jest za wysoki
2. Interwał nie jest za długi
3. Urządzenie faktycznie się zmienia

**Dostosuj:**
```
ustaw próg zmian 5%
ustaw interwał 10s
```

### Problem: Action hints nie działają

**Wymagany format:**
```
- "komenda" — Opis
```

**Niepoprawne:**
```
- komenda — Opis          # Brak cudzysłowów
* "komenda" — Opis        # Zły znak listy
- "komenda" Opis          # Brak separatora
```

## 📚 Więcej informacji

- `NETWORK_SCAN_IMPROVEMENTS.md` - szczegóły techniczne
- `INLINE_ACTION_HINTS_DEMO.md` - przykłady integracji
- `CHANGELOG_NETWORK_IMPROVEMENTS.md` - pełny changelog

## 🎓 Wskazówki

1. **Zawsze próbuj najpierw skanowania** - może wykryć kamery automatycznie
2. **Używaj action hints** - szybsze niż pisanie komend
3. **Zapisz znane IP** - system zapamiętuje historię
4. **Dostosuj parametry** - każda kamera jest inna
5. **Sprawdź logi** - historia zmian pomaga debugować
6. **Uruchom Tauri** - dla najlepszych wyników

## ✨ Nowe w wersji 1.0.36

- ✅ WebSocket probe dla lepszego wykrywania
- ✅ Inline action hints (klikalne sugestie)
- ✅ Niższy timing threshold (15ms)
- ✅ Więcej portów dla kamer (8554, 81)
- ✅ Lepszy UX przy 0 wynikach
- ✅ Tracking metod wykrycia
- ✅ Wszystkie testy przechodzą (469/469)
