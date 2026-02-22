# Test AuthBrowsePlugin

## 🎯 Cel
Testowanie nowego pluginu AuthBrowsePlugin do przeglądania stron z uwierzytelnianiem.

## 🔧 Wprowadzone zmiany

### 1. Backend Rust (src-tauri/src/main.rs)
- Zmodyfikowano funkcję `browse` aby akceptowała nagłówki:
  ```rust
  async fn browse(url: String, headers: Option<std::collections::HashMap<String, String>>) -> Result<BrowseResult, String>
  ```
- Dodano obsługę nagłówków w żądaniach HTTP

### 2. Frontend Plugin (src/plugins/authBrowse/authBrowsePlugin.ts)
- Stworzono nowy plugin `AuthBrowsePlugin`
- Obsługuje różne formaty uwierzytelniania:
  - `--user <username> --pass <password>`
  - `--username <username> --password <password>`
  - `z uwierzytelnieniem <username>:<password>`
  - `admin:password@` w URL
- Implementuje poprawny interfejs `Plugin` z `PluginResult`
- Używa Basic Auth przez nagłówek `Authorization`

### 3. Rejestracja (src/core/bootstrap.ts)
- Dodano `AuthBrowsePlugin` do rejestru pluginów

## 🧪 Scenariusze testowe

### Test 1: Podstawowe uwierzytelnianie
**Komenda:** `przeglądaj http://192.168.188.146 --user admin --pass 123456`

**Oczekiwane rezultaty:**
- ✅ Plugin rozpoznaje komendę
- ✅ Ekstrahuje credentials (admin:123456)
- ✅ Wysyła nagłówek `Authorization: Basic YWRtaW46MTIzNDU2`
- ✅ Otrzymuje dostęp do interfejsu kamery
- ✅ Zwraca zawartość strony bez DuckDuckGo

### Test 2: Różne formaty komend
```bash
# Format 1: --user --pass
przeglądaj http://192.168.188.146 --user admin --pass 123456

# Format 2: --username --password
browse http://192.168.188.146 --username admin --password 123456

# Format 3: po polsku
otwórz http://192.168.188.146 z uwierzytelnieniem admin:123456

# Format 4: bezpośrednio w URL
przeglądaj http://admin:123456@192.168.188.146
```

### Test 3: Obsługa błędów
```bash
# Brak URL
przeglądaj --user admin --pass 123456
→ Error: "Nie znaleziono URL w komendzie"

# Brak credentials
przeglądaj http://192.168.188.146
→ Error: "Nie znaleziono danych uwierzytelniających"

# Złe credentials
przeglądaj http://192.168.188.146 --user wrong --pass wrong
→ Error: "Błąd przeglądania: 401 Unauthorized"
```

## 🔍 Diagnostyka

### Logi z pluginu:
Plugin loguje:
- `Executing auth browse command`
- `Extracted credentials` (bez hasła)
- `Making authenticated request via Tauri`
- `Auth browse completed` z metrykami

### Logi z Rust backend:
Backend loguje:
- `Command browse invoked for URL`
- `Adding header: Authorization: Basic ...`
- Status HTTP i content-type

## 🚀 Uruchomienie testu

### W aplikacji Tauri:
1. Uruchom Broxeen: `npm run tauri dev`
2. Wpisz w czacie: `przeglądaj http://192.168.188.146 --user admin --pass 123456`
3. Obserwuj wynik i logi

### Przez CLI (jeśli działa):
```bash
echo "przeglądaj http://192.168.188.146 --user admin --pass 123456" | node scripts/chat-cli.mjs
```

## 📊 Oczekiwane wyniki

### Sukces:
- Strona kamery ładuje się bez DuckDuckGo
- Zawartość HTML jest poprawnie wyświetlana
- Screenshot może być zrobiony (jeśli dostępny)
- Tytuł strony jest poprawnie ekstrahowany

### Porównanie:
- **Bez uwierzytelniania:** DuckDuckGo challenge page
- **Z uwierzytelnianiem:** Prawdziwy interfejs kamery Reolink

## 🐛 Możliwe problemy

### Problem: Plugin nie jest wykrywany
**Rozwiązanie:** Sprawdź konsolę deweloperską pod kątem błędów ładowania pluginu

### Problem: Błąd 401 Unauthorized
**Rozwiązanie:** Sprawdź credentials - może admin:123456 nie jest poprawne

### Problem: Błąd CORS
**Rozwiązanie:** Tauri omija CORS, więc problem może być w konfiguracji kamery

### Problem: Brak nagłówków w Rust
**Rozwiązanie:** Sprawdź, czy funkcja browse poprawnie otrzymuje parametr headers

## ✅ Checklist

- [x] Backend Rust obsługuje nagłówki
- [x] Frontend plugin implementuje interfejs
- [x] Plugin jest zarejestrowany
- [x] TypeScript kompiluje się bez błędów
- [x] Rust kompiluje się bez błędów
- [ ] Test przeglądania z uwierzytelnianiem
- [ ] Weryfikacja, że DuckDuckGo jest omijany
