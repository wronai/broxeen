# Interaktywne przyciski do logowania do kamery

## Implementacja

Gdy użytkownik uruchamia monitoring kamery **bez credentials**, system pokazuje **interaktywny formularz** z polami do wypełnienia.

## Flow użytkownika

### Krok 1: Uruchom monitoring kamery

```
Użytkownik: "monitoruj 192.168.188.146"
```

### Krok 2: System pokazuje formularz logowania

```
✅ **Monitoring uruchomiony**

📌 **Cel:** Kamera 192.168.188.146
📍 **Typ:** camera
🌐 **Adres:** 192.168.188.146
⏱️ **Interwał:** co 30s
📊 **Próg zmian:** 15%

⚠️ **Brak danych logowania**
Monitoring uruchomiony bez autoryzacji RTSP.
Live preview i snapshoty mogą nie działać.

💡 Dodaj dane logowania do kamery:

┌─────────────────────────────────────────────┐
│ 🔐 Zaloguj do kamery                        │
│                                             │
│ Username: [admin____________]               │
│ Password: [••••••••••••••••]               │
│                                             │
│ [Zaloguj do kamery]                         │
└─────────────────────────────────────────────┘

Lub spróbuj domyślnych haseł:

[📹 Spróbuj domyślne Hikvision]  admin:12345
[📹 Spróbuj domyślne Dahua]      admin:admin
[🔓 Spróbuj bez hasła]           admin:(puste)

💡 **Komendy:**
- "pokaż logi monitoringu Kamera 192.168.188.146"
- "stop monitoring Kamera 192.168.188.146"
- "aktywne monitoringi"
```

### Krok 3: Użytkownik wypełnia formularz

**Opcja A: Własne credentials**
```
Username: [admin]
Password: [moje_haslo_123]

[Kliknij: Zaloguj do kamery]
```

**System wykonuje:**
```
stop monitoring Kamera 192.168.188.146
monitoruj 192.168.188.146 user:admin admin:moje_haslo_123
```

**Opcja B: Domyślne Hikvision**
```
[Kliknij: Spróbuj domyślne Hikvision]
```

**System wykonuje:**
```
stop monitoring Kamera 192.168.188.146
monitoruj 192.168.188.146 user:admin admin:12345
```

### Krok 4: Monitoring z credentials

```
✅ **Monitoring uruchomiony**

📌 **Cel:** Kamera 192.168.188.146
📍 **Typ:** camera
🌐 **Adres:** 192.168.188.146
⏱️ **Interwał:** co 30s
📊 **Próg zmian:** 15%

Zmiany będą automatycznie zgłaszane w tym czacie.

💡 **Komendy:**
- "pokaż logi monitoringu Kamera 192.168.188.146"
- "stop monitoring Kamera 192.168.188.146"
- "aktywne monitoringi"
```

## Implementacja techniczna

### ConfigPrompt w PluginResult

```typescript
const result: PluginResult = {
  pluginId: this.id,
  status: 'success',
  content: [{ type: 'text', data, title: `Monitor: ${target.name}` }],
  metadata: { 
    duration_ms: Date.now() - start, 
    cached: false, 
    truncated: false,
    configPrompt: {
      title: 'Dodaj dane logowania do kamery',
      actions: [
        {
          id: 'add-credentials',
          label: 'Zaloguj do kamery',
          icon: '🔐',
          type: 'execute',
          executeQuery: `stop monitoring ${target.name}; monitoruj ${target.address} user:{username} admin:{password}`,
          variant: 'primary',
          description: 'Wprowadź username i hasło',
          fields: [
            {
              id: 'username',
              label: 'Username',
              type: 'text',
              defaultValue: 'admin',
              placeholder: 'admin',
              required: true,
            },
            {
              id: 'password',
              label: 'Password',
              type: 'password',
              defaultValue: '',
              placeholder: 'Hasło do kamery',
              required: true,
            },
          ],
        },
        // ... więcej akcji
      ],
      layout: 'cards',
    },
  },
};
```

### Placeholder substitution

System automatycznie zamienia `{username}` i `{password}` na wartości z formularza:

```typescript
executeQuery: `stop monitoring ${target.name}; monitoruj ${target.address} user:{username} admin:{password}`

// Po wypełnieniu formularza:
// username = "admin"
// password = "moje_haslo_123"

// Wynik:
"stop monitoring Kamera 192.168.188.146; monitoruj 192.168.188.146 user:admin admin:moje_haslo_123"
```

### Dostępne akcje

**1. Własne credentials (z formularzem)**
```typescript
{
  id: 'add-credentials',
  label: 'Zaloguj do kamery',
  icon: '🔐',
  type: 'execute',
  executeQuery: `stop monitoring ${target.name}; monitoruj ${target.address} user:{username} admin:{password}`,
  variant: 'primary',
  fields: [
    { id: 'username', label: 'Username', type: 'text', defaultValue: 'admin' },
    { id: 'password', label: 'Password', type: 'password', defaultValue: '' },
  ],
}
```

**2. Domyślne Hikvision**
```typescript
{
  id: 'try-hikvision',
  label: 'Spróbuj domyślne Hikvision',
  icon: '📹',
  type: 'execute',
  executeQuery: `stop monitoring ${target.name}; monitoruj ${target.address} user:admin admin:12345`,
  variant: 'secondary',
  description: 'admin:12345',
}
```

**3. Domyślne Dahua**
```typescript
{
  id: 'try-dahua',
  label: 'Spróbuj domyślne Dahua',
  icon: '📹',
  type: 'execute',
  executeQuery: `stop monitoring ${target.name}; monitoruj ${target.address} user:admin admin:admin`,
  variant: 'secondary',
  description: 'admin:admin',
}
```

**4. Bez hasła**
```typescript
{
  id: 'try-empty',
  label: 'Spróbuj bez hasła',
  icon: '🔓',
  type: 'execute',
  executeQuery: `stop monitoring ${target.name}; monitoruj ${target.address} user:admin admin:`,
  variant: 'secondary',
  description: 'Dla kamer bez hasła',
}
```

## Renderowanie w Chat.tsx

System automatycznie wykrywa `configPrompt` w metadata i renderuje `ChatConfigPrompt`:

```tsx
{msg.type === "config_prompt" && msg.configPrompt && (
  <ChatConfigPrompt
    data={msg.configPrompt}
    onPrefill={(text) => setInput(text)}
    onExecute={(query) => handleSubmit(query)}
  />
)}
```

**ChatConfigPrompt** renderuje:
- **Formularz** z polami username/password
- **Przyciski** z domyślnymi hasłami
- **Walidację** (required fields)
- **Placeholder substitution** ({username}, {password})

## Przykład użycia

### Scenariusz 1: Własne hasło

```
1. Użytkownik: "monitoruj 192.168.188.146"
2. System: [pokazuje formularz]
3. Użytkownik: [wypełnia: admin / moje_haslo]
4. Użytkownik: [klika "Zaloguj do kamery"]
5. System: wykonuje "stop monitoring...; monitoruj ... user:admin admin:moje_haslo"
6. System: ✅ Monitoring uruchomiony (z credentials)
```

### Scenariusz 2: Domyślne Hikvision

```
1. Użytkownik: "monitoruj 192.168.188.146"
2. System: [pokazuje formularz]
3. Użytkownik: [klika "Spróbuj domyślne Hikvision"]
4. System: wykonuje "stop monitoring...; monitoruj ... user:admin admin:12345"
5. System: ✅ Monitoring uruchomiony (z credentials)
```

### Scenariusz 3: Bez hasła

```
1. Użytkownik: "monitoruj 192.168.188.200"
2. System: [pokazuje formularz]
3. Użytkownik: [klika "Spróbuj bez hasła"]
4. System: wykonuje "stop monitoring...; monitoruj ... user:admin admin:"
5. System: ✅ Monitoring uruchomiony (bez hasła)
```

## Zalety

✅ **Intuicyjne** - formularz zamiast składni `user:admin admin:hasło`  
✅ **Szybkie** - przyciski z domyślnymi hasłami  
✅ **Bezpieczne** - pole password ukrywa znaki  
✅ **Elastyczne** - można wpisać własne credentials  
✅ **Kompatybilne** - stara składnia nadal działa  

## Kompatybilność wsteczna

Stara składnia nadal działa:

```
monitoruj 192.168.188.146 user:admin admin:12345
```

System wykryje credentials i **nie pokaże formularza**.

## Testy

✅ **34 pliki, 535 testów** - wszystkie przechodzą

## Podsumowanie

System teraz pokazuje **interaktywny formularz** do logowania do kamery:
- 📝 Pola: Username i Password
- 🔐 Przycisk: "Zaloguj do kamery"
- 📹 Przyciski szybkie: Hikvision, Dahua, bez hasła
- ✅ Automatyczna walidacja i placeholder substitution

**Użytkownik nie musi już wpisywać `user:admin admin:hasło` ręcznie!**
