# Broxeen — System Auto-Konfiguracji i Interaktywnego UI

## Przegląd

Broxeen posiada centralny system konfiguracji (`ConfigStore`) który:
- **Eliminuje hardkodowane dane** — wszystkie wartości konfiguracyjne (IP, porty, URL-e, klucze API, timeouty) czyta z jednego źródła
- **Auto-wykrywa ustawienia** — przy starcie wykrywa podsieć, dostępność Tauri, status LLM
- **Interaktywne przyciski w chacie** — bot odpowiada klikanymi przyciskami, formularzami i sugestiami
- **Persystencja w localStorage** — konfiguracja jest zapamiętywana między sesjami
- **Nadpisywanie przez .env** — zmienne środowiskowe mają priorytet nad localStorage

## Architektura

```
.env / env vars
     ↓ (nadpisuje)
┌──────────────┐
│  ConfigStore │  ← singleton, ładowany raz przy starcie
│  (appConfig) │  ← deep merge: defaults ← localStorage ← env
└──────┬───────┘
       │
       ├── llmClient.ts      (apiUrl, apiKey, model, temperature...)
       ├── sttClient.ts      (model, language, maxTokens...)
       ├── networkScanPlugin  (ports, subnets, timeouts, batch size...)
       ├── sshPlugin          (timeout, default port, default user...)
       ├── Chat.tsx           (camera ports, stream paths...)
       └── pluginContext/bootstrap (locale)
```

## Komendy konfiguracyjne w chacie

| Komenda | Efekt |
|---------|-------|
| `konfiguracja` / `settings` / `config` | Przegląd konfiguracji z przyciskami |
| `konfiguruj ai` / `config ai` | Konfiguracja klucza API i modelu LLM |
| `konfiguruj sieć` / `config network` | Konfiguracja podsieci i portów |
| `resetuj konfigurację` | Przywrócenie domyślnych ustawień |
| `pomoc` / `help` | Lista dostępnych akcji z klikanymi przyciskami |

## Interaktywne elementy w odpowiedziach bota

### Typy akcji (`ConfigAction`)

| Typ | Opis |
|-----|------|
| `prefill` | Wstawia tekst do pola wpisywania (user edytuje przed wysłaniem) |
| `set_config` | Natychmiast zmienia wartość w ConfigStore |
| `execute` | Wykonuje podaną komendę (jak kliknięcie "Wyślij") |
| `link` | Otwiera URL w nowej karcie |

### Layouty

| Layout | Opis |
|--------|------|
| `buttons` | Małe przyciski w jednym wierszu (flex-wrap) |
| `cards` | Karty z ikoną, tytułem i opisem |
| `inline` | Kompaktowe przyciski w jednym wierszu |

### Pola edytowalne (`editableFields`)

Config prompt może zawierać pola formularzy inline (np. pole na klucz API z przyciskiem "Zapisz"). Pola te:
- Odczytują aktualną wartość z `ConfigStore`
- Po kliknięciu "Zapisz" zapisują do `ConfigStore` i oznaczają się jako ✅
- Obsługują typy: `string`, `number`, `password`, `select` (z opcjami)

## Pliki

| Plik | Opis |
|------|------|
| `src/config/appConfig.ts` | Typy, wartości domyślne, metadata pól |
| `src/config/configStore.ts` | Singleton store z get/set/reset/onChange |
| `src/config/autoConfig.ts` | Auto-detekcja przy starcie |
| `src/components/ChatConfigPrompt.tsx` | Komponent UI + buildery promptów |
| `src/domain/chatEvents.ts` | Typ `config_prompt` w ChatMessage |
| `src/config/configStore.test.ts` | Testy ConfigStore |
| `src/components/ChatConfigPrompt.test.tsx` | Testy komponentu UI |

## Docker

```bash
# Testy
docker compose --profile test up --build

# Produkcja (statyczny build)
docker compose up --build

# Development (hot reload)
docker compose --profile dev up --build
```

Porty:
- **4173** — produkcja (serve)
- **5173** — development (vite dev)

## Zmienne środowiskowe (.env)

```bash
# LLM / AI
VITE_OPENROUTER_API_KEY=sk-or-v1-...
VITE_LLM_MODEL=google/gemini-3-flash-preview
VITE_LLM_MAX_TOKENS=2048
VITE_LLM_TEMPERATURE=0.7
VITE_LLM_API_URL=https://openrouter.ai/api/v1/chat/completions

# STT
VITE_STT_MODEL=google/gemini-2.0-flash
VITE_STT_LANG=pl

# Sieć
VITE_DEFAULT_SUBNET=192.168.1

# Locale
VITE_LANGUAGE=pl
VITE_LOCALE=pl-PL
```

Wszystkie te wartości można też zmienić w runtime przez komendę `konfiguracja` w chacie.
