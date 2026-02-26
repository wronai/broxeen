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

### 🔍 Inteligentne Skanowanie
- [x] **Filtrowanie wyników** - tylko kamery, tylko konkretne typy

### 💬 Ulepszenia Chat UI
- [x] **Responsywność pływających przycisków** - dopasowanie na bardzo wąskich oknach (opcjonalne skrócone etykiety)

### 🎯 Interakcja i Wsparcie Użytkownika
- [ ] **Drag & drop reorder** — użytkownik sortuje ulubione akcje na ekranie powitalnym

### 🌐 Wieloplatformowość
- [ ] **Android tablet/smartphone** - responsywny UI
- [ ] **PWA (Progressive Web App)** - instalowalna aplikacja
- [ ] **Offline mode** - podstawowe funkcje bez internetu
- [ ] **Synchronizacja** - między urządzeniami

### 📊 Analiza i Monitorowanie
- [x] **Statystyki użycia** - najczęściej używane funkcje
- [ ] **Export danych** - CSV, JSON raporty

### 🔧 Techniczne Ulepszenia
- [x] **Real-time updates** - WebSocket dla natychmiastowych zmian
- [x] **Cache system** - przyspieszenie powtarzających się zapytań
- [x] **Error recovery** - automatyczne ponawianie błędnych operacji

### 🧪 Stabilność testów
- [x] **Vitest: "Worker exited unexpectedly"** — zdiagnozować crash tinypool/worker i dodać stabilny tryb uruchamiania testów (np. pool/config)
- [x] **React tests: warning act(...)** — uspokoić warningi w `Chat.test.tsx` (wrap state updates w `act` lub `await` na asynchroniczne efekty)

### 📌 Kamera live — follow-up
- [x] **Typowanie payload `camera_live`** — usunięto `any` dla `initialBase64/initialMimeType`, ujednolicono typy w `chatEvents.ts` i `Chat.tsx`
- [x] **`camera_id` jako cache/metrics tag** — dodano `frame_count`, `frame_age_ms`, `started_at` do `LiveFrameCache` + komenda `rtsp_worker_stats` + wyświetlanie w `CameraLiveInline`

---

## 🧠 REFAKTORYZACJA: Hardcoded NL → LLM + Schema

**Cel:** Zastąpić wszystkie hardkodowane wzorce text/regex centralnym systemem LLM + Schema,
wzorowanym na architekturze `nlp2cmd`. Każdy krok zachowuje fallback na keyword-matching
gdy LLM niedostępny.

**Architektura docelowa:**
```
User NL Query
  → LLM Intent Classifier (schema-constrained, temperature=0)
    → { intent, entities, confidence }
      → Plugin Router (by intent)
        → Plugin.execute(input, entities, context)
```

**Już zrobione:**
- [x] **R0: Rust text-to-SQL** — `query_schema.rs` + `llm_query.rs` + `vision_query` LLM-first z fallback
- [x] **R1: MonitorPlugin** — `COMMAND_ROUTES` + `CAN_HANDLE_PATTERNS` data-driven tables
- [x] **R2: motion_detection.rs** — `LABEL_MAP`, generic `extract_time_filter`, `extract_limit`

### Faza 1: Centralny LLM Intent Classifier (WYSOKI PRIORYTET)

- [x] **R3: `src/core/intentRouter.ts` — LLM-first intent detection**
  - ~550 linii hardkodowanych regex (19+ intent grup, ~200 wzorców)
  - Zastąpić `initializeDefaultPatterns()` + `detect()` wywołaniem LLM z ACTION_SCHEMAS jako kontekstem
  - LLM zwraca `{ intent: string, entities: Record<string,unknown>, confidence: number }`
  - Fallback: obecne regex-matching gdy LLM niedostępny
  - `calculateConfidence()` i `extractEntities()` — usunąć hardkodowane mapy, LLM wyciąga entities
  - **Plik:** `src/core/intentRouter.ts:17-570` (initializeDefaultPatterns)
  - **Plik:** `src/core/intentRouter.ts:625-739` (calculateConfidence + extractEntities)

- [x] **R4: `src/core/actionSchema.ts` — zunifikowany schema jako LLM context**
  - `findDomainSchemas()` — hardkodowana mapa `domainHints` (60+ słów kluczowych) → LLM
  - `scoreMatch()` — keyword counting → LLM confidence
  - ACTION_SCHEMAS.keywords już istnieją — użyć ich jako kontekstu LLM zamiast ręcznego dopasowania
  - **Plik:** `src/core/actionSchema.ts:409-504`

### Faza 2: Plugin canHandle → schema-driven (WYSOKI PRIORYTET)

- [x] **R5: `src/plugins/discovery/networkScanPlugin.ts` — canHandle + isStatusQuery**
  - 6 tablic keyword arrays (scan/camera/rpi/status/filter/export) ~40 stringów
  - Zastąpić deklaratywną definicją w schema → router decyduje, plugin nie sprawdza
  - **Plik:** `src/plugins/discovery/networkScanPlugin.ts:27-82`

- [x] **R6: `src/plugins/system/sshPlugin.ts` — canHandle + TEXT2SSH_PATTERNS**
  - `canHandle`: 7 hardkodowanych `lower.includes()` + regex
  - `TEXT2SSH_PATTERNS`: 14 entries mapping NL → shell commands
  - `resolveCommand()`: regex-matching NL do komend
  - `looksLikeShellCommand()`: hardkodowane shell indicators
  - Zastąpić: LLM + schema generuje command z opisu NL
  - **Plik:** `src/plugins/system/sshPlugin.ts:14-85` (TEXT2SSH_PATTERNS)
  - **Plik:** `src/plugins/system/sshPlugin.ts:93-105` (canHandle)
  - **Plik:** `src/plugins/system/sshPlugin.ts:252-297` (resolveCommand + looksLikeShellCommand)

- [x] **R7: `src/plugins/email/emailPlugin.ts` — canHandle + request classification**
  - `canHandle`: 10+ `lower.includes()` + regex
  - `isConfigRequest`, `isSendRequest`, `isInboxRequest`, `isPollConfigRequest`: 4 metody z regex
  - **Plik:** `src/plugins/email/emailPlugin.ts:54-145`

- [x] **R8: `src/plugins/files/fileSearchPlugin.ts` — canHandle**
  - 20+ `lower.includes()` + 15 regex patterns
  - **Plik:** `src/plugins/files/fileSearchPlugin.ts:50-96`

- [x] **R9: `src/plugins/protocol-bridge/protocolBridgePlugin.ts` — canHandle + execute routing**
  - `canHandle`: 20+ regex tests
  - `execute`: 8 regex-based if/else routing blocks
  - `detectProtocolFromInput`: hardkodowane NL cues
  - `handleAdd`: regex protocol detection
  - **Plik:** `src/plugins/protocol-bridge/protocolBridgePlugin.ts:123-270`

- [x] **R18: `src/plugins/monitor/monitorPlugin.ts` — COMMAND_ROUTES wewnętrzny routing**
  - Już data-driven (COMMAND_ROUTES + CAN_HANDLE_PATTERNS) — wzorcowa implementacja
  - `parseToggleMonitoring`: regex extraction
  - **Plik:** `src/plugins/monitor/monitorPlugin.ts:118-197`

### Faza 3: Chat.tsx config commands (ŚREDNI PRIORYTET)

- [x] **R19: `src/components/Chat.tsx` — handleConfigCommand**
  - 6 regex bloków → CONFIG_COMMAND_ROUTES table + switch
  - **Plik:** `src/components/Chat.tsx:1291-1379`

### Faza 4: Rust backend keyword routing (ŚREDNI PRIORYTET)

- [ ] **R20: `src-tauri/src/query_schema.rs` — detect_data_source**
  - 30+ `q.contains()` keyword checks to route to Monitoring/Devices/Chat data source
  - Już ma LLM text-to-SQL, ale routing jest keyword-based
  - **Plik:** `src-tauri/src/query_schema.rs:197-233`

- [ ] **R21: `src-tauri/src/motion_detection.rs` — nl_to_sql fallback**
  - `nl_to_sql`: 4 `q.contains()` blocks → counting/stats/camera/default queries
  - `extract_time_filter`: 10+ keyword/regex patterns
  - `extract_label_filter`: `LABEL_MAP` lookup
  - `extract_limit`: 2 regex patterns
  - **Plik:** `src-tauri/src/motion_detection.rs:812-951`

- [ ] **R22: `src-tauri/src/network_scan.rs` — classify_device**
  - Port-based device classification (camera/iot-broker/server/web-device/unknown)
  - Nie NL ale heurystyka — schema mógłby zdefiniować device signatures
  - **Plik:** `src-tauri/src/network_scan.rs:1423-1448`

### Faza 5: Infrastruktura wspólna

- [x] **R23: Stwórz `src/core/llmIntentClassifier.ts`**
  - Moduł wywołujący LLM z ACTION_SCHEMAS jako kontekstem
  - Constrained output: `{ intent, entities, confidence }`
  - Cache: ten sam input → ten sam intent (memoize)
  - Timeout + fallback na regex

- [x] **R24: Stwórz `src/core/intentSchema.ts`**
  - Zunifikowany schema format łączący ACTION_SCHEMAS + intent patterns
  - Każdy plugin deklaruje swoje intenty w jednym obiekcie schema
  - Plugin.intentSchema zamiast Plugin.canHandle

- [x] **R25: Testy regresji dla refaktoryzacji**
  - Dla każdego R3-R22: test że te same inputy dają te same intenty/wyniki
  - Property: LLM path i fallback path dają identyczny routing

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
## Issues Found - 2026-02-24

- [JS005-noentrypointmainmoduleexports] 🔵 **No entry point (main/module/exports)** (`package.json`)
  - Consider adding a "main" or "exports" field for proper module resolution.

---

## 🧹 Cleanup / Refactoring — 2026-02-26

### Wykonane
- [x] **Fix TS build error** — `__TAURI__` on Window w `monitorPlugin.ts` (cast do `Window & { __TAURI__?: unknown }`)
- [x] **Usunięto duplikat `local-network/`** — `src/plugins/local-network/` był klonem `src/plugins/network/` z tymi samymi ID pluginów. Przeniesiono `WakeOnLanPlugin` do `network/`, usunięto cały `local-network/`
- [x] **Testy dla network/** — nowy `network.test.ts` z 28 testami (wszystkie pass)
- [x] **Konsolidacja `AudioSettings`** — usunięto duplikat z `main.rs`, jedyne źródło to `settings.rs` z re-exportem `pub use settings::AudioSettings`
- [x] **Konsolidacja `load_settings()`** — usunięto duplikaty z `tts.rs` i `audio_commands.rs`, import z `crate::settings::load_settings`
- [x] **Usunięto dead TS hooks** — `useAudio.ts`, `useBackendStt.ts`, `useBackendTts.ts` z `src-tauri/src/` (React hooks w katalogu Rust, nigdzie nie importowane)
- [x] **Usunięto orphan test files** — 11 plików z roota (`test-*.js/ts`, `test_*.js/py`) + 3 z `src-tauri/` (`test_anon.rs`, `test_read.rs` x2)
- [x] **0 cargo warnings** — naprawiono `static_mut_refs` w `local_llm.rs` (OnceLock), `#[allow(dead_code)]` dla API publicznego, unused imports/vars
- [x] **0 tsc errors** — `tsc --noEmit` czyste

### Runda 2 (kontynuacja)
- [x] **Naprawiono 7/8 pre-existing test failures** (8→1):
  - `logsPlugin.test.ts` (3 testy) — mock `configStore` module zamiast fake context property
  - `cameraLivePlugin.test.ts` (2 testy) — dodano `ping_host_simple` mock w Tauri invoke
  - `quickActionResolver.test.ts` (2 testy) — dodano RSS keyword matcher + action generator
- [x] **Usunięto dead `http-browse/`** — duplikat `http/browsePlugin`, nigdzie nie importowany
- [x] **Usunięto 8 orphan plików z roota** — `local_llm_*.py/json`, `mock_*.py`, `phonetic.py`, `dev.log`, `setup_local_llm.sh`, `project.toon`
- [x] **Ustrukturyzowane logowanie w `bootstrap.ts`** — zamieniono 40+ `console.log/warn` na `createScopedLogger('bootstrap')` + naprawiono podwójne `registry.register(plugin)` w `safeRegister`
- [x] **Zbadano camera/ vs cameras/** — to NIE są duplikaty (camera/ = live preview, cameras/ = health/ptz/snapshot)
- [x] **RSS support w quickActionResolver** — nowy `RSS_KEYWORDS` + `RSS_URL_RE` + akcje `qa-rss-monitor`/`qa-rss-refresh`

### Pozostały 1 test failure
- `Chat.test.tsx > konfiguruj monitoring pokazuje config prompt` — React rendering/timing issue w teście integracyjnym

### Statystyki końcowe
- **tsc**: ✅ 0 errors
- **cargo check**: ✅ 0 warnings
- **Testy**: 962 pass / 1 fail (z początkowych 966 pass / 8 fail → naprawiono 7, usunięto 3 dead test files)

### Do zrobienia
- [ ] **Naprawić Chat.test.tsx config prompt** — React rendering/timing issue
- [ ] **R20–R22**: Rust backend keyword routing → LLM (z TODO fazy 4)
- [ ] **Dodać `"main"` lub `"exports"` do `package.json`** (JS005)
- [ ] **Export danych** — CSV, JSON raporty
- [ ] **Android tablet/smartphone** — responsywny UI / PWA


