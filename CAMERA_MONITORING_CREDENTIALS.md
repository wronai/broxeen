# Camera Monitoring z Credentials i Live Preview

## Problem

System monitoringu kamer nie:
1. ❌ Nie pyta o user/hasło do kamery RTSP
2. ❌ Nie pokazuje live preview (miniaturka 1fps)
3. ❌ Nie wykrywa zmian wizualnych w obrazie
4. ❌ Nie integruje się z AI do analizy zmian

## Rozwiązanie (w trakcie implementacji)

### Krok 1: Prompt o credentials ✅

Gdy użytkownik wykonuje `monitoruj 192.168.188.146`, system:

1. Wykrywa, że to kamera (IP + brak credentials)
2. Zwraca **ChatConfigPrompt** z formularzem logowania
3. Użytkownik wypełnia user/hasło
4. System wykonuje `monitoruj 192.168.188.146 user:admin admin:12345`

**Implementacja:**
```typescript
// Wykryj kamerę bez credentials
const isCamera = parsed.type === 'camera' || /\d+\.\d+\.\d+\.\d+/.test(parsed.address);
const hasCredentials = input.includes('user:') || input.includes('admin:');

if (isCamera && !hasCredentials) {
  return {
    metadata: {
      configPrompt: {
        title: 'Dane logowania do kamery',
        actions: [{
          id: 'camera-credentials',
          label: 'Zaloguj i rozpocznij monitoring',
          type: 'execute',
          executeQuery: `monitoruj ${parsed.address} user:admin admin:12345`,
          fields: [
            { id: 'username', label: 'Użytkownik', type: 'text', defaultValue: 'admin' },
            { id: 'password', label: 'Hasło', type: 'password' },
          ],
        }],
      },
    },
  };
}
```

### Krok 2: RTSP Snapshot Grabbing (TODO)

**Integracja z RtspCameraPlugin:**

```typescript
// W poll() dla kamery
if (target.type === 'camera' && target.rtspUrl) {
  // Pobierz snapshot przez RTSP
  const snapshot = await this.grabRtspSnapshot(target.rtspUrl, context);
  
  if (snapshot) {
    target.lastSnapshot = snapshot; // base64 image
    
    // Zapisz w logu
    target.logs.push({
      timestamp: Date.now(),
      type: 'snapshot',
      message: 'Pobrano snapshot z kamery',
      snapshot,
    });
  }
}
```

**Metoda grabRtspSnapshot:**

```typescript
private async grabRtspSnapshot(
  rtspUrl: string,
  context: PluginContext
): Promise<string | null> {
  if (context.isTauri && context.tauriInvoke) {
    // Tauri backend - FFmpeg snapshot
    try {
      const result = await context.tauriInvoke('rtsp_snapshot', {
        url: rtspUrl,
        timeout: 5000,
      }) as { success: boolean; data?: string };
      
      return result.success ? result.data || null : null;
    } catch (err) {
      console.error('[Monitor] RTSP snapshot failed:', err);
      return null;
    }
  } else {
    // Browser - HTTP snapshot fallback
    const ip = rtspUrl.match(/(\d+\.\d+\.\d+\.\d+)/)?.[1];
    if (ip) {
      try {
        const response = await fetch(`http://${ip}/snapshot.jpg`);
        const blob = await response.blob();
        return await this.blobToBase64(blob);
      } catch {
        return null;
      }
    }
  }
  return null;
}

private blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
```

### Krok 3: Live Preview w Chat (TODO)

**Rozszerzenie ChatMessage:**

```typescript
// src/domain/chatEvents.ts
export interface ChatMessage {
  // ... existing fields
  cameraPreview?: {
    ip: string;
    snapshot: string; // base64
    lastUpdate: number;
    fps: number; // 1fps dla monitoringu
  };
}
```

**Renderowanie w Chat.tsx:**

```tsx
{msg.cameraPreview && (
  <div className="mt-4 border rounded-lg p-4">
    <div className="flex items-center gap-2 mb-2">
      <span className="text-sm font-medium">📹 Live Preview</span>
      <span className="text-xs text-gray-500">
        {msg.cameraPreview.ip} • {msg.cameraPreview.fps}fps
      </span>
    </div>
    <img
      src={msg.cameraPreview.snapshot}
      alt="Camera preview"
      className="w-full rounded border"
    />
    <div className="text-xs text-gray-500 mt-1">
      Ostatnia aktualizacja: {new Date(msg.cameraPreview.lastUpdate).toLocaleTimeString()}
    </div>
  </div>
)}
```

### Krok 4: AI Visual Change Detection (TODO)

**Integracja z LLM:**

```typescript
// W poll() po pobraniu snapshot
if (target.lastSnapshot && previousSnapshot) {
  // Porównaj wizualnie przez AI
  const changeDescription = await this.detectVisualChanges(
    previousSnapshot,
    target.lastSnapshot,
    context
  );
  
  if (changeDescription) {
    target.logs.push({
      timestamp: Date.now(),
      type: 'change',
      message: `🔔 Zmiana wykryta: ${changeDescription}`,
      snapshot: target.lastSnapshot,
    });
    
    // Wyślij powiadomienie do czatu
    this.notifyChange(target, changeDescription);
  }
}
```

**Metoda detectVisualChanges:**

```typescript
private async detectVisualChanges(
  previousSnapshot: string,
  currentSnapshot: string,
  context: PluginContext
): Promise<string | null> {
  if (!context.describeImage) return null;
  
  try {
    // Opisz oba obrazy
    const prevDescription = await context.describeImage(previousSnapshot);
    const currDescription = await context.describeImage(currentSnapshot);
    
    // Porównaj opisy przez LLM
    const prompt = `Porównaj dwa opisy obrazu z kamery i opisz różnice:

Poprzedni obraz: ${prevDescription}
Aktualny obraz: ${currDescription}

Opisz tylko istotne zmiany (ruch osób, pojazdów, zmiana oświetlenia). Jeśli brak zmian, zwróć "brak zmian".`;

    const llmResponse = await this.callLLM(prompt);
    
    return llmResponse.toLowerCase().includes('brak zmian') ? null : llmResponse;
  } catch (err) {
    console.error('[Monitor] Visual change detection failed:', err);
    return null;
  }
}
```

### Krok 5: Powiadomienia w czasie rzeczywistym (TODO)

**Event-based notifications:**

```typescript
// W MonitorPlugin
private notifyChange(target: MonitorTarget, description: string) {
  // Wyślij event do Chat.tsx
  window.dispatchEvent(new CustomEvent('monitor:change', {
    detail: {
      targetId: target.id,
      targetName: target.name,
      description,
      snapshot: target.lastSnapshot,
      timestamp: Date.now(),
    },
  }));
}
```

**Obsługa w Chat.tsx:**

```typescript
useEffect(() => {
  const handleMonitorChange = (event: CustomEvent) => {
    const { targetName, description, snapshot, timestamp } = event.detail;
    
    // Dodaj wiadomość do czatu
    eventStore.append({
      type: 'message_added',
      payload: {
        id: timestamp,
        role: 'assistant',
        text: `🔔 **Zmiana na ${targetName}**\n\n${description}`,
        type: 'camera_change',
        cameraPreview: {
          ip: event.detail.targetId.replace('device-', ''),
          snapshot,
          lastUpdate: timestamp,
          fps: 1,
        },
      },
    });
  };
  
  window.addEventListener('monitor:change', handleMonitorChange as EventListener);
  return () => window.removeEventListener('monitor:change', handleMonitorChange as EventListener);
}, []);
```

## Flow użytkownika

### Scenariusz 1: Monitoring z credentials

```
Użytkownik: "monitoruj 192.168.188.146"

System: 📷 Konfiguracja monitoringu kamery
        Kamera: Kamera 192.168.188.146
        Adres: 192.168.188.146
        
        [Formularz]
        Użytkownik: [admin]
        Hasło: [••••••]
        
        [Zaloguj i rozpocznij monitoring] [Monitoruj bez autoryzacji]

Użytkownik: [wypełnia formularz i klika przycisk]

System: ✅ Monitoring uruchomiony
        📌 Cel: Kamera 192.168.188.146
        🌐 Adres: 192.168.188.146
        ⏱️ Interwał: co 30s
        📊 Próg zmian: 15%
        
        [Live Preview - miniaturka 640x480]
        📹 192.168.188.146 • 1fps
        [obraz z kamery]
        
        Zmiany będą automatycznie zgłaszane w tym czacie.

[Po 30s - wykryto zmianę]

System: 🔔 Zmiana na Kamera 192.168.188.146
        
        Wykryto ruch osoby w prawej części kadru.
        Osoba wchodzi do budynku.
        
        [Live Preview - miniaturka z zaznaczoną zmianą]
        📹 192.168.188.146 • 1fps
        [obraz z kamery z czerwoną ramką wokół osoby]
```

### Scenariusz 2: Monitoring bez credentials (kamera bez hasła)

```
Użytkownik: "monitoruj 192.168.188.200"

System: [prompt o credentials]

Użytkownik: [klika "Monitoruj bez autoryzacji"]

System: ✅ Monitoring uruchomiony (bez autoryzacji)
        ⚠️ Kamera może wymagać logowania - niektóre funkcje mogą nie działać
        
        [Live Preview - próba pobrania snapshot]
        ❌ Brak dostępu do RTSP (401 Unauthorized)
        
        💡 Sugerowane akcje:
        - "zatrzymaj monitoring" i podaj credentials
        - "skanuj porty 192.168.188.200" - sprawdź dostępne porty
```

## Tauri Backend (RTSP Snapshot)

**Nowa komenda Rust:**

```rust
// src-tauri/src/rtsp_snapshot.rs
use std::process::Command;

#[tauri::command]
pub async fn rtsp_snapshot(url: String, timeout: u64) -> Result<RtspSnapshotResult, String> {
    // Użyj FFmpeg do pobrania jednej klatki z RTSP
    let output = Command::new("ffmpeg")
        .args(&[
            "-rtsp_transport", "tcp",
            "-i", &url,
            "-frames:v", "1",
            "-f", "image2pipe",
            "-vcodec", "png",
            "-"
        ])
        .output()
        .map_err(|e| format!("FFmpeg failed: {}", e))?;
    
    if output.status.success() {
        let base64 = base64::encode(&output.stdout);
        Ok(RtspSnapshotResult {
            success: true,
            data: Some(format!("data:image/png;base64,{}", base64)),
        })
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[derive(serde::Serialize)]
pub struct RtspSnapshotResult {
    success: bool,
    data: Option<String>,
}
```

## Status implementacji

- [x] Rozszerzenie MonitorTarget o pola RTSP
- [x] Wykrywanie kamer i prompt o credentials
- [x] Parsowanie credentials z inputu
- [x] Generowanie RTSP URL z auth
- [ ] RTSP snapshot grabbing (Tauri + browser fallback)
- [ ] Live preview w Chat.tsx
- [ ] AI visual change detection
- [ ] Real-time notifications
- [ ] Testy integracyjne

## Następne kroki

1. Naprawić testy MonitorPlugin (credentials prompt blokuje start)
2. Zaimplementować `grabRtspSnapshot()` z Tauri backend
3. Dodać `cameraPreview` do ChatMessage
4. Zintegrować z AI dla visual change detection
5. Dodać real-time notifications przez CustomEvents
6. Testy end-to-end dla pełnego flow
