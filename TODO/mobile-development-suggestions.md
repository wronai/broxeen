# Sugestie rozwoju Broxeen - Mobile + Multi-protocol

## Architektura mobilna
```
broxeen-mobile/
├── src/
│   ├── components/
│   │   ├── MobileChat.tsx      # Minimalistyczny chat UI
│   │   ├── VoiceInput.tsx      # Floating mic button
│   │   └── PreviewPanel.tsx    # Collapsible content preview
│   ├── services/
│   │   ├── apiClient.ts        # Unified client (HTTP/WS/MQTT)
│   │   ├── cameraClient.ts     # RTSP + scene description
│   │   └── voiceClient.ts       # Optimized STT/TTS
│   └── hooks/
│       ├── useMobileVoice.ts   # Mobile-optimized voice
│       └── useRealtime.ts      # WebSocket/MQTT handling
├── native/                     # React Native bridges
└── backend/                    # Rust microservice
```

## Multi-protocol endpoints
```rust
// Nowe komendy Tauri
#[tauri::command]
async fn mqtt_publish(topic: String, payload: String) -> Result<(), String>

#[tauri::command]
async fn rtsp_stream_description(url: String) -> Result<CameraDescription, String>

#[tauri::command]
async fn websocket_connect(endpoint: String) -> Result<WebSocketId, String>
```

## Optymalizacje mobile
- **Progressive Web App** (PWA) jako pierwszy krok
- **React Native** dla native performance
- **Offline cache** dla częstych zapytań
- **Push notifications** dla real-time updates

## Integracje planowane
1. **Kamery RTSP** + AI scene description
2. **MQTT sensors** (IoT devices)
3. **WebSocket streaming** (real-time data)
4. **REST API** (external integrations)

## Minimalistyczny UI design
```
┌─────────────────────────┐
│  🎤 [Ask anything...]   │ ← One input field
├─────────────────────────┤
│ 📹 Camera 1: Person...  │ ← Quick preview
│ 📡 Sensor: Temp 22°C    │ ← Compact status
└─────────────────────────┘
```

## Priorytety implementacji
1. **PWA version** (quickest win)
2. **WebSocket streaming** 
3. **RTSP + AI description**
4. **MQTT integration**
5. **React Native app**
