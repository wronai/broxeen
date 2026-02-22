# Test Powiększania Obrazów w Czacie Broxeen

## 🎯 Cel
Testowanie nowej funkcji powiększania obrazów z kamer i screenshotów w czacie.

## 🔧 Wprowadzone zmiany

### 1. Stan expandedImage
- Zmieniono ze `string | null` na `{ data: string; mimeType?: string } | null`
- Pozwala na przechowywanie zarówno danych obrazu, jak i jego typu MIME

### 2. Obsługa klikania
- **Obrazy z kamer**: `onClick={() => setExpandedImage({ data: msg.text, mimeType: msg.mimeType || 'image/jpeg' })}`
- **Screenshoty**: `onClick={() => msg.screenshotBase64 && setExpandedImage({ data: msg.screenshotBase64, mimeType: 'image/png' })}`

### 3. Style wizualne
- Dodano `cursor-pointer hover:opacity-90 transition-opacity` dla obrazów
- Użytkownik widzi, że obraz jest klikalny

### 4. Powiększony obraz
- Renderowanie z poprawnym typem MIME: `data:${expandedImage.mimeType || 'image/jpeg'};base64,${expandedImage.data}`
- Obsługuje różne formaty (JPEG, PNG, etc.)

### 5. Obsługa klawisza ESC
- Dodano useEffect do nasłuchwania klawisza Escape
- Zamyka powiększony obraz po naciśnięciu ESC

## 🧪 Scenariusze testowe

### Test 1: Powiększanie obrazu z kamery
1. Uruchom Broxeen: `npm run tauri dev`
2. Wyślij komendę: `przeglądaj rtsp://admin:123456@192.168.188.146:554/h264Preview_01_main`
3. Poczekaj na odpowiedź z obrazem
4. **Kliknij na obraz** - powinien się powiększyć na cały ekran
5. **Sprawdź:**
   - Obraz jest wyświetlony w pełnej rozdzielczości
   - Tło jest czarne z przezroczystością 90%
   - Przycisk "Zamknij (ESC)" jest widoczny
   - Kliknięcie w tło zamyka obraz

### Test 2: Powiększanie screenshotu
1. Wyślij komendę: `przeglądaj http://192.168.188.146`
2. Poczekaj na odpowiedź ze screenshotem
3. **Kliknij na screenshot** - powinien się powiększyć
4. **Sprawdź:**
   - Screenshot jest wyświetlony w pełnej rozdzielczości
   - Działa tak samo jak obraz z kamery

### Test 3: Obsługa klawisza ESC
1. Powiększ dowolny obraz
2. **Naciśnij klawisz ESC** - obraz powinien się zamknąć
3. Powtórz dla obrazu z kamery i screenshotu

### Test 4: Różne typy MIME
1. Testuj obrazy JPEG (z kamery)
2. Testuj obrazy PNG (screenshots)
3. Sprawdź, czy oba formaty wyświetlają się poprawnie

## ✅ Oczekiwane rezultaty

- ✅ Obrazy są klikalne (kursor zmienia się na pointer)
- ✅ Hover effect (przezroczystość 90%)
- ✅ Powiększenie na cały ekran działa
- ✅ Obsługuje różne typy MIME
- ✅ Klawisz ESC zamyka powiększenie
- ✅ Kliknięcie w tło zamyka powiększenie
- ✅ Przycisk "Zamknij (ESC)" działa

## 🐹 Możliwe problemy i rozwiązania

### Problem: Obraz nie powiększa się
**Rozwiązanie:** Sprawdź konsolę deweloperską pod kątem błędów JavaScript

### Problem: Zły typ MIME
**Rozwiązanie:** Upewnij się, że `msg.mimeType` jest poprawnie ustawiony w wiadomości

### Problem: ESC nie działa
**Rozwiązanie:** Sprawdź, czy useEffect jest poprawnie dodany i czy nie ma konfliktów z innymi handlerami klawiszy

## 📝 Uwagi

- Funkcja działa zarówno dla obrazów z kamer RTSP, jak i screenshotów stron WWW
- Zachowuje się spójnie z istniejącym powiększaniem screenshotów
- Jest w pełni responsywna i dostępna
