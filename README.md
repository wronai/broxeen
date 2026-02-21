# ⚡ ChatBrowse — Przeglądaj Internet przez Chat

Chat-based web browser MVP. Zamiast tradycyjnej przeglądarki z zakładkami, paskami adresu i reklamami — wpisujesz (lub mówisz) zapytanie w chat i dostajesz czysty, czytelny content.

## Szybki start

```bash
# Produkcja
make prod
# → http://localhost:8080

# Development (hot reload)
make dev

# Testy
make test          # lokalnie
make test-docker   # w Docker
```

## Architektura

```
chatbrowse/
├── app/
│   ├── __init__.py        # Package + create_app export
│   ├── config.py          # Config / TestConfig
│   ├── factory.py         # Flask app factory
│   ├── routes.py          # API endpoints
│   ├── phonetic.py        # Mowa → URL normalizacja
│   ├── resolver.py        # URL resolution pipeline
│   ├── extractor.py       # Content extraction (readability)
│   ├── cache.py           # File-based cache z TTL
│   ├── contacts.py        # Kontakty/zakładki URI
│   ├── domains.py         # Baza znanych domen (~90)
│   ├── templates/
│   │   └── index.html     # Chat UI + Speech API
│   └── static/
├── tests/
│   ├── conftest.py        # Shared fixtures
│   ├── test_phonetic.py   # 15+ testów normalizacji
│   ├── test_resolver.py   # 18+ testów resolution
│   ├── test_cache.py      # 9+ testów cache
│   ├── test_contacts.py   # 14+ testów CRUD
│   ├── test_extractor.py  # 16+ testów ekstrakcji
│   └── test_routes.py     # 13+ testów API
├── wsgi.py                # Entrypoint
├── Dockerfile             # Multi-stage (base/test/production)
├── docker-compose.yml     # prod + dev + test profiles
├── Makefile               # Dev commands
├── requirements.txt
└── pyproject.toml
```

## API

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/` | GET | Chat UI |
| `/api/browse` | POST | Resolve + fetch + extract |
| `/api/resolve` | POST | Tylko resolution (debug) |
| `/api/contacts` | GET | Lista kontaktów |
| `/api/contacts` | POST | Dodaj kontakt |
| `/api/contacts/delete` | POST | Usuń kontakt |
| `/api/cache/clear` | POST | Wyczyść cache |
| `/health` | GET | Health check |

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
make help          # Wszystkie komendy
make install       # Zainstaluj zależności
make test          # Testy + coverage
make test-docker   # Testy w Docker
make dev           # Dev server (hot reload)
make prod          # Production (gunicorn)
make clean         # Cleanup
make lint          # Sprawdź kompilację
```

## License

Apache License 2.0 - see [LICENSE](LICENSE) for details.

## Author

Created by **Tom Sapletta** - [tom@sapletta.com](mailto:tom@sapletta.com)
