# ⚡ Broxeen — Przeglądaj Internet przez Chat z TTS

Desktopowa aplikacja Tauri do przeglądania internetu przez chat z wbudowanym TTS.
Zamiast tradycyjnej przeglądarki — wpisujesz (lub mówisz) zapytanie i dostajesz czysty content, który możesz odsłuchać.

## Szybki start

```bash
# Zainstaluj zależności
npm install

# Development z hot reload
npm run tauri dev

# Build produkcyjny
npm run tauri build
```

## Architektura

```
broxeen/
├── src-tauri/
│   ├── Cargo.toml          # Rust dependencies
│   ├── tauri.conf.json     # Tauri config (permissions, window)
│   ├── build.rs            # Tauri build script
│   └── src/
│       └── main.rs         # Tauri commands (fetch, extract)
├── src/
│   ├── main.tsx            # React entry
│   ├── App.tsx             # Main app component
│   ├── index.css           # TailwindCSS
│   ├── components/
│   │   ├── Chat.tsx        # Chat UI
│   │   ├── Settings.tsx    # Audio device settings
│   │   └── TtsControls.tsx # TTS playback controls
│   ├── hooks/
│   │   ├── useTts.ts       # TTS hook (Web Speech API)
│   │   └── useSpeech.ts    # Speech recognition hook
│   └── lib/
│       ├── phonetic.ts     # Mowa → URL normalizacja
│       └── resolver.ts     # URL resolution pipeline
├── index.html              # Vite entry
├── package.json
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.json
└── phonetic.py             # Original Python module
```

## Tauri Commands

| Komenda | Opis |
|---------|------|
| `browse` | Resolve + fetch + extract content |
| `resolve` | URL resolution (phonetic + fuzzy) |
| `tts_speak` | Odczytaj tekst przez TTS |
| `tts_stop` | Zatrzymaj TTS |
| `get_settings` | Pobierz ustawienia audio |
| `save_settings` | Zapisz ustawienia audio |

## Pipeline rozwiązywania URL

```
Input użytkownika
    │
    ├─→ "https://google.com"     → [exact] bezpośredni URL
    ├─→ "onet.pl"                → [exact] bare domain + https://
    ├─→ "onet kropka pe el"      → [fuzzy] phonetic → onet.pl
    ├─→ "facbook"                → [fuzzy] SequenceMatcher → facebook.com
    ├─→ "facbok"                 → [ambiguous] sugestie do wyboru
    └─→ "restauracje Gdynia"    → [search] DuckDuckGo fallback
```

## Rozwiązania problemów fonetycznych

| Problem | Rozwiązanie |
|---------|-------------|
| Złożone domeny | Fuzzy match z bazą ~90 popularnych domen |
| Polskie komendy mowy | 30+ reguł: "kropka"→`.`, "pe el"→`pl` |
| Niska pewność rozpoznania | Lista sugestii "Czy chodziło Ci o..." |
| Nieznane domeny | Fallback na DuckDuckGo search |
| Szybki dostęp | Kontakty jako zakładki — zero dyktowania |

## Komendy

```bash
npm install        # Zainstaluj zależności frontend
npm run tauri dev  # Development (hot reload)
npm run tauri build # Build produkcyjny (.deb/.AppImage/.exe)
```

## License

Apache License 2.0 - see [LICENSE](LICENSE) for details.

## Author

Created by **Tom Sapletta** - [tom@sapletta.com](mailto:tom@sapletta.com)
