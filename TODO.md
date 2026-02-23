projekt wymaga jeszce pracy, dlatego zapraszam do zgłaszania sugestii, 
finalnie chciałbym aby to działało jako aplikacja na jakimś android tablet/smartfon w celu szybkiego odpytania o coś z opcja podgladu, minimalizujac ilosc informacji.
będzie więcej endpointów, teraz mamy http, potem dodam API rest/ws , mqtt, kamery rstp z opisem sceny na kamerze, itd
mozliwosc skanowania urzadzen w sieci lokalnej
znajdywanie uslug dostepnych na nich
i jesli to kamera to mozliwosc odpytania
oraz tworzenia historii zmian na danym endpoincie, aby bot z chat  sygnalizowal automatycznie o zmianach stanu/tresci na danej stronie
nie wiem tylko jak stworzyc menu do zarzadzania,czy wystarczy w chat  stworzyc okno czasowe
np jesli bylo odpytywane w ciagu ostatniej godziny to bedzie informowalo o wszelkich zmianach w ciagu nastepnej godziny?

np. jesli dzis odpytywales o cos odnosnie kamery, bylo pytanie o to co dzieje sie na wybranej kamerze to przy zmianach
automatycznie uzytkownik bedzie informowany, ze tam sie cos zmienilo
jednoczesnie raz wykryte urzadzenie powinno pozostac do dyspoczcyji gdy bedzi eo nie pytanie
aby nie trzeba było na nowo skanowac calej sieci i inicjiowac konfiguracji, ewentualnie restu

dlatego lista stron, urzadzen powinna byc zapisywana do bazy sqlite
wszystkie wiadomosci chat w osobnej bazie danych


aktualnie prację nad scope: internet globalny/lokalny/vpn/tor
oraz marketplace dla plugings, np wyszukiwanie kamer w sieci lokalnej przez arp, itd
dzięki temu możliwe będzie nie tylko odnajdywanie urządzeń, ale też interakcja i monitorowanie, np jeśli zaznaczymy flagę MONITOR, to dane urządzenie/endpoint będzie monitorowany i analizowany przez LLM w celu np znalezienia różnic
czyli mogę zlecić zaddaanie monitorowania kamer z automatyczną informacją zwrotną gdy coś się dzieje i mam dostęp do logów w postaci kontekstu w chat
w ten sposob można też szybciej analizować sieć, anomalie, dostęp do aaktywnych urządzeń, bez potrzeby szukania odpowiedniego narzędzia, w odroznieniu od innych rozwiazań, chcę zachować prostotę, aby konfiguracja była możliwe bezpośrednio przez chat

---

## 🚀 NOWE ULEPSZENIA SYSTEMU (v2.0+)

### 🤖 Inteligentny Asystent z Propozycjami
- [x] **System proponowania akcji** — `MessageQuickActions` + `quickActionResolver` — kontekstowe przyciski na dole każdej odpowiedzi asystenta ✅
- [x] **Kontekstowe sugestie** — auto-detekcja IP, URL, kamer, portów, SSH w treści wiadomości → odpowiednie akcje ✅
- [x] **Interaktywne wybieranie** — klikalne karty na ekranie powitalnym (6 akcji) + inline buttons na wiadomościach ✅
- [x] **Uczenie się preferencji** — `PreferenceLearningStore` + tracking w `ChatConfigPrompt` + ranking w `fallbackHandler` ✅

### 📺 Podgląd Kamier i Urządzeń
- [x] **Live preview kamer** - podgląd wideo (1 FPS dla oszczędności)
- [x] **RTSP kompatybilność Tauri (cameraId/camera_id)** - spójne argumenty `rtsp_capture_frame` + testy regresyjne
- [ ] **Status urządzeń** - online/offline, ostatnia aktywność → `device_status` w DeviceRepository + ping-based health check
- [x] **Szybkie akcje** — kliknij przycisk na wiadomości → ping, porty, SSH, monitor, live kamera ✅
- [ ] **Galeria znalezionych** - przeglądaj wszystkie odkryte urządzenia

### 🔍 Inteligentne Skanowanie
- [x] **Skanowanie przyrostowe** - tylko nowe urządzenia (`calculateIncrementalRanges()`, `determineScanStrategy()`) ✅
- [x] **Historia skanowań** - zapamiętaj co znaleziono (`ScanHistoryRepository`, `scan_history` table) ✅
- [ ] **Automatyczne ponawianie** - periodiczne sprawdzanie statusu
- [ ] **Filtrowanie wyników** - tylko kamery, tylko konkretne typy

### 💬 Ulepszenia Chat UI
- [x] **Sugerowane komendy** — ekran powitalny z 6 kartami akcji + `ActionSuggestions` z uczeniem się ✅
- [x] **Historia z kategoriami** — `CommandHistory` category filter tabs (Sieć/Kamery/Strony/Czat/Inne) z licznikami i aktywnym podświetleniem ✅
- [x] **Szybkie odpowiedzi** — `MessageQuickActions` generuje predefiniowane follow-up komendy per wiadomość ✅
- [x] **Wizualizacja wyników** — `MessageResultCard` auto-detects domain → colored border + icon badge + status pill ✅
- [x] **Pływające przyciski diagnostyki/błędów** - przeniesione na prawą stronę nad scope i skompresowane do jednej linii
- [ ] **Responsywność pływających przycisków** - dopasowanie na bardzo wąskich oknach (opcjonalne skrócone etykiety)

### 🎯 Interakcja i Wsparcie Użytkownika
- [x] **Quick-start welcome screen** — 6 klikalnych kart akcji na ekranie powitalnym (skanuj, kamery, przeglądaj, konfiguracja, monitoruj, pomoc) ✅
- [x] **Context-aware message actions** — `quickActionResolver` analizuje treść → generuje do 5 akcji (ping, porty, SSH, browse, monitor, snapshot) ✅
- [x] **Execute/Prefill/Link actions** — trzy tryby akcji: execute (natychmiast), prefill (wstaw do inputa), link (otwórz URL) ✅
- [ ] **Wizard konfiguracyjny** — step-by-step setup: API key → model → podsieć → kamery
- [ ] **Onboarding flow** — pierwszy start z interaktywnym tutorialem
- [x] **Feedback na akcjach** — animacja sukcesu (green pulse + bounce checkmark 600ms) w `ChatConfigPrompt` dla buttons/cards/inline ✅
- [ ] **Drag & drop reorder** — użytkownik sortuje ulubione akcje na ekranie powitalnym
- [ ] **Keyboard shortcuts** — Ctrl+1..6 dla szybkich akcji z welcome screen

### 🌐 Wieloplatformowość
- [ ] **Android tablet/smartphone** - responsywny UI
- [ ] **PWA (Progressive Web App)** - instalowalna aplikacja
- [ ] **Offline mode** - podstawowe funkcje bez internetu
- [ ] **Synchronizacja** - między urządzeniami

### 📊 Analiza i Monitorowanie
- [ ] **Dashboard urządzeń** - podsumowanie stanu sieci
- [ ] **Alerty o zmianach** - automatyczne powiadomienia
- [ ] **Statystyki użycia** - najczęściej używane funkcje
- [ ] **Export danych** - CSV, JSON raporty

### 🔧 Techniczne Ulepszenia
- [x] **Action Schema + Fallback Handler** — `actionSchema.ts` (25+ schemas) + `fallbackHandler.ts` (LLM/keyword/generic) + scope fix (`chat-llm` w `local`) ✅
- [x] **Plugin system v2** - dynamiczne ładowanie pluginów ✅ v2.0.0
- [x] **Scoped plugins** - foldery per scope (local-network, cameras, marketplace) ✅ v2.0.0
- [x] **Marketplace** - zdalne ładowanie pluginów community ✅ v2.0.0
- [x] **Dev workflow (Tauri+Vite)** - `tauri dev` uruchamia Vite przez `beforeDevCommand`, `make dev` czyści port 5173 ✅
- [x] **SQLite migracje deterministyczne** - migracje wykonywane sekwencyjnie + `db_execute` obsługuje multi-statement SQL ✅
- [ ] **Real-time updates** - WebSocket dla natychmiastowych zmian
- [ ] **Cache system** - przyspieszenie powtarzających się zapytań
- [ ] **Error recovery** - automatyczne ponawianie błędnych operacji

### 🧪 Stabilność testów
- [ ] **Vitest: "Worker exited unexpectedly"** — zdiagnozować crash tinypool/worker i dodać stabilny tryb uruchamiania testów (np. pool/config)
- [ ] **React tests: warning act(...)** — uspokoić warningi w `Chat.test.tsx` (wrap state updates w `act` lub `await` na asynchroniczne efekty)

### 📌 Kamera live — follow-up
- [x] **Typowanie payload `camera_live`** — usunięto `any` dla `initialBase64/initialMimeType`, ujednolicono typy w `chatEvents.ts` i `Chat.tsx`
- [x] **`camera_id` jako cache/metrics tag** — dodano `frame_count`, `frame_age_ms`, `started_at` do `LiveFrameCache` + komenda `rtsp_worker_stats` + wyświetlanie w `CameraLiveInline`

---

## 🎯 PRIORYTETY NA NAJBLIŻSZY CZAS

### Wysoki Priorytet (Teraz)
1. **System proponowania akcji** - interaktywne wybieranie opcji
2. **Podgląd kamer** - wizualizacja znalezionych urządzeń
3. **Popularne komendy** - szybki dostęp do najczęstszych akcji

### Średni Priorytet (Wkrótce)
1. **Historia urządzeń** - zapamiętywanie stanu sieci
2. **Dashboard** - przegląd wszystkich urządzeń
3. **PWA support** - instalowalna aplikacja

### Niski Priorytet (Później)
1. **Android natywny** - dedykowana aplikacja
2. **Zaawansowane analizy** - statystyki i raporty
3. **Multi-user** - wiele profili użytkowników



---

## 📦 DOSTĘPNE PLUGINY (v2.0.0)

### 🌐 Sieć lokalna (`src/plugins/local-network/`)

| Plugin | Intent | Przykład użycia |
|--------|--------|-----------------|
| PingPlugin | `network:ping` | `ping 192.168.1.1` |
| PortScanPlugin | `network:port-scan` | `skanuj porty 192.168.1.100` |
| ArpPlugin | `network:arp` | `tablica arp` / `adresy mac` |
| WakeOnLanPlugin | `network:wol` | `obudź urządzenie AA:BB:CC:DD:EE:FF` |
| MdnsPlugin | `network:mdns` | `odkryj usługi mdns` / `bonjour` |
| OnvifPlugin | `camera:onvif` | `odkryj kamery onvif` |
| NetworkScanPlugin | `network:scan` | `skanuj sieć` / `pokaż kamery` |

### 📷 Kamery (`src/plugins/cameras/`)

| Plugin | Intent | Przykład użycia |
|--------|--------|-----------------|
| CameraHealthPlugin | `camera:health` | `status kamery` / `czy kamera działa` |
| CameraPtzPlugin | `camera:ptz` | `obróć kamerę w lewo` / `przybliż` |
| CameraSnapshotPlugin | `camera:snapshot` | `zrób zdjęcie kamerą wejściową` |
| RtspCameraPlugin | `camera:describe` | `co widać na kamerze ogrodowej` |

### 🏪 Marketplace (`src/plugins/marketplace/`)

| Plugin | Intent | Przykład użycia |
|--------|--------|-----------------|
| MarketplacePlugin | `marketplace:browse` | `marketplace` / `zainstaluj plugin UPnP` |

### 🌍 Internet (`src/plugins/http/`, `src/plugins/chat/`)

| Plugin | Intent | Przykład użycia |
|--------|--------|-----------------|
| HttpBrowsePlugin | `browse:url` | `https://example.com` |
| ChatLlmPlugin | `chat:ask` | dowolny tekst (fallback) |

### 👁️ Monitoring (`src/plugins/monitor/`)

| Plugin | Intent | Przykład użycia |
|--------|--------|-----------------|
| MonitorPlugin | `monitor:start` | `monitoruj kamerę wejściową` |
| MonitorPlugin | `monitor:stop` | `stop monitoring kamery` |
| MonitorPlugin | `monitor:list` | `aktywne monitoringi` |
| MonitorPlugin | `monitor:logs` | `pokaż logi monitoringu` |
| MonitorPlugin | `monitor:config` | `ustaw próg zmian 20%` |

### 🌉 Protocol Bridge v2 (`src/plugins/protocol-bridge/`)

| Protokół | Kierunek | Przykład użycia |
|----------|----------|-----------------|
| MQTT | ↔ dwukierunkowy | `bridge mqtt home/sensors/temperature` / `wyślij mqtt home/lights on` |
| REST API | ↔ dwukierunkowy | `bridge rest GET https://api.example.com` / `wyślij rest POST https://url {}` |
| WebSocket | ↔ dwukierunkowy | `bridge ws wss://echo.websocket.events` / `wyślij ws wss://url hello` |
| SSE | → tylko odbiór | `bridge sse https://api.example.com/events` / `nasłuchuj na zdarzenia z https://...` |
| GraphQL | ↔ dwukierunkowy | `bridge graphql https://url { users { name } }` / `zapytaj api https://url { ... }` |

**Zarządzanie mostami:**
- `dodaj bridge <protokół> <url>` — skonfiguruj most
- `lista bridge` — pokaż skonfigurowane mosty
- `bridge status` — status połączeń
- `usuń bridge <id>` — usuń most

**Język naturalny (PL):**
- "połącz się z websocketem wss://..." → auto-detect WebSocket
- "nasłuchuj na zdarzenia z https://..." → auto-detect SSE
- "zapytaj api https://..." → auto-detect GraphQL

**UX:** Każda odpowiedź zawiera sugerowane akcje (klikalne komendy), voice-friendly summary (TTS), auto-detekcję protokołu z URL.

### 🔑 Scopes (6)

- **local** — tylko LAN: sieć, kamery, IoT, monitoring, protocol-bridge
- **network** — LAN + internet: wszystko + marketplace + protocol-bridge
- **internet** — tylko internet: browse, LLM, marketplace, protocol-bridge
- **vpn** — VPN: pełny dostęp LAN + internet przez tunel
- **tor** — Tor: anonimowe przeglądanie .onion + monitoring
- **remote** — pluginy z marketplace

### 📋 Przykłady pełnych przepływów

**Odkrywanie kamer:**
```
> odkryj kamery onvif
> status kamery wejściowej
> zrób zdjęcie kamerą wejściową
> obróć kamerę ogrodową w lewo
> przybliż kamerę ogrodową
```

**Skanowanie sieci:**
```
> skanuj sieć
> ping 192.168.1.100
> skanuj porty 192.168.1.100
> tablica arp
> odkryj usługi mdns
> obudź urządzenie AA:BB:CC:DD:EE:FF
```

**Marketplace:**
```
> marketplace
> szukaj plugin bandwidth
> zainstaluj plugin UPnP
> odinstaluj plugin UPnP
```

**Monitoring kamer (MONITOR flag):**
```
> monitoruj kamerę wejściową
> monitoruj kamerę ogrodową co 15s próg 10%
> monitoruj 192.168.1.100 co 60s
> aktywne monitoringi
> pokaż logi monitoringu
> ustaw próg zmian 20%
> ustaw interwał 5m
> stop monitoring kamery wejściowej
```

**Pełny przepływ: odkrycie → monitoring → alerty:**
```
> skanuj sieć                           # znajdź urządzenia
> odkryj kamery onvif                   # wykryj kamery
> status kamery wejściowej              # sprawdź stan
> monitoruj kamerę wejściową co 30s     # włącz monitoring
> aktywne monitoringi                   # lista aktywnych
> pokaż logi monitoringu               # historia zmian
> stop monitoring kamery wejściowej     # wyłącz monitoring
```

---

wyszukaj kamere w sieci lokalnej:
Oto najważniejsze sposoby i narzędzia, które pomogą Ci odnaleźć kamerę w sieci lokalnej:

Strona Dipol poleca darmową aplikację SADP. Jest to proste narzędzie służące do wyszukiwania w sieci lokalnej kamer i rejestratorów marki Hikvision. Pozwala ono także na zmianę hasła czy edycję parametrów sieciowych.

Serwis Kompletny Przewodnik wyjaśnia, że podstawą jest poznanie adresu IP kamery. Można to zrobić za pomocą wiersza poleceń w systemie Windows, wpisując komendę arp -a. Wyświetli ona listę wszystkich urządzeń podłączonych do sieci wraz z ich adresami fizycznymi.

Portal Overmax opisuje narzędzie SearchPro Tool. Po podłączeniu kamery do routera i uruchomieniu tego programu wystarczy kliknąć przycisk wyszukiwania, aby na ekranie pojawił się dokładny adres IP urządzenia.

Firma Kenik w swojej instrukcji wskazuje na program Device Manager. Przypomina również, że wiele kamer ma ustawiony domyślny adres, na przykład 192.168.1.100, który warto sprawdzić w pierwszej kolejności.

Eksperci ze strony Digitaldep zaznaczają, że samo znalezienie kamery w sieci lokalnej to pierwszy krok. Jeśli chcesz mieć do niej dostęp spoza domu, konieczna będzie dodatkowa konfiguracja przekierowania portów na routerze.

Witryna IPOX podkreśla, że producenci często dostarczają dedykowane oprogramowanie wspierające użytkownika, które automatyzuje proces wykrywania sprzętu i pomaga uniknąć konfliktów adresów w sieci.
URL: https://html.duckduckgo.com/html/?q=wyszukaj%20kamere%20w%20sieci%20lokalnej
