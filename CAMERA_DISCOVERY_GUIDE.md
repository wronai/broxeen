# 🎥 Wykrywanie kamer IP w Broxeen v2.1

## 📋 Przegląd funkcjonalności

Broxeen v2.1 obsługuje wykrywanie kamer IP w sieci lokalnej za pomocą zintegrowanego systemu pluginów i intent routing.

## 🔍 Jak to działa

### 1. Intent Detection
System rozpoznaje zapytania o wykrywanie kamer w sieci lokalnej:

**Obsługiwane zapytania:**
- ✅ "znajdź kamere w sieci lokalnej"
- ✅ "znajdź kamere w sieci lokalnej:"
- ✅ "skanuj siec w poszukiwaniu kamer"
- ✅ "odkryj kamery w sieci"
- ✅ "wyszukaj kamere w lokalnej sieci"
- ✅ "skanuj siec kamerami"
- ✅ "poszukaj kamer w sieci"
- ✅ "odkryj kamery lokalnej"

### 2. Routing do NetworkScanPlugin
Po wykryciu intentu `network:scan`, system routuje zapytanie do `NetworkScanPlugin`.

### 3. Network Discovery
`NetworkScanPlugin` wykonuje:
- **Ping sweep** całej podsieci
- **mDNS discovery** dla urządzeń Bonjour
- **SSDP discovery** dla urządzeń UPnP
- **ARP table scanning** dla aktywnych urządzeń

### 4. Service Probing
`ServiceProbePlugin` sprawdza znalezione urządzenia pod kątem:
- **Portów HTTP/HTTPS** (80, 443, 8080, 8443)
- **RTSP streamów** (554, 8554)
- **MQTT brokerów** (1883, 8883)
- **SSH access** (22)
- **API endpoints**

### 5. Device Classification
System klasyfikuje urządzenia jako:
- **Camera** (na podstawie portów RTSP, HTTP signatures)
- **Server** (na podstawie otwartych portów usługowych)
- **IoT Device** (na podstawie MQTT, specyficznych portów)
- **Unknown** (gdy nie można zidentyfikować)

## 🎯 Wynik dla użytkownika

### Przykładowa odpowiedź:
```
🔍 Skanowanie sieci lokalnej...

Znaleziono 3 urządzenia:

📷 Kamera IP (Hikvision)
   Adres: 192.168.1.45
   Porty: 80 (HTTP), 554 (RTSP)
   Status: Online
   Ostatnio widziany: 2 minuty temu

📷 Kamera WiFi (Reolink)
   Adres: 192.168.1.67
   Porty: 80 (HTTP), 443 (HTTPS), 554 (RTSP)
   Status: Online
   Ostatnio widziany: 5 minut temu

💻 Serwer (NAS)
   Adres: 192.168.1.10
   Porty: 80 (Web UI), 443 (HTTPS), 22 (SSH)
   Status: Online
   Ostatnio widziany: 1 minuta temu

📊 Podsumowanie:
- 2 kamery IP znalezione
- 1 inne urządzenie znalezione
- Czas skanowania: 3.2 sekundy
```

## ⚙️ Konfiguracja

### Domyślne ustawienia skanowania:
- **Zakres sieci:** Automatycznie wykrytywaany z adresu IP klienta
- **Timeout ping:** 1000ms
- **Concurrent scans:** 50 wątków
- **Porty do sprawdzenia:** 22, 80, 443, 554, 1883, 8080, 8443, 8554

### Możliwości konfiguracji:
```typescript
// W przyszłości dostępne w UI
const networkConfig = {
  scanTimeout: 5000,
  maxConcurrent: 100,
  customPorts: [8080, 9000],
  excludeRanges: ['192.168.1.1-192.168.1.10']
};
```

## 🔧 Technologia

### Komponenty v2.1:
- **IntentRouter:** Pattern matching dla zapytań
- **NetworkScanPlugin:** Implementacja skanowania sieci
- **ServiceProbePlugin:** Probing usług na urządzeniach
- **DatabaseManager:** Przechowywanie wyników w SQLite
- **WatchManager:** Monitoring zmian w czasie rzeczywistym

### Protokoły:
- **ICMP Ping** - sprawdzanie dostępności
- **mDNS** - wykrywanie urządzeń Bonjour
- **SSDP** - wykrywanie urządzeń UPnP
- **TCP Port Scanning** - sprawdzanie usług
- **HTTP Fingerprinting** - identyfikacja typów urządzeń

## 🚀 Użycie

1. **Otwórz aplikację Broxeen**
2. **Wpisz zapytanie:** "znajdź kamere w sieci lokalnej"
3. **Poczekaj na wyniki skanowania**
4. **Kliknij na znalezioną kamerę** aby uzyskać dostęp do panelu

## 📝 Przykładowe zapytania

```bash
# Podstawowe
znajdź kamere w sieci lokalnej
skanuj siec w poszukiwaniu kamer
odkryj kamery w sieci

# Zaawansowane
wyszukaj kamery rtsp w lokalnej sieci
poszukaj urządzeń ip z otwartym portem 554
znajdź wszystkie kamery hikvision w sieci
```

## 🔮 Przyszłe funkcje

- **Auto-watch:** Automatyczne monitorowanie znalezionych kamer
- **Stream preview:** Podgląd strumieni wideo bezpośrednio w Broxeen
- **Camera control:** Sterowanie PTZ przez ONVIF
- **Motion detection:** Integrowane z systemem reaktywnym
- **Mobile app:** Dostęp z urządzeń mobilnych

---

## 🎉 Gotowe do użycia!

Funkcjonalność wykrywania kamer w Broxeen v2.1 jest **w pełni zintegrowana** i gotowa do użycia. System wykorzystuje nową architekturę pluginów z zachowaniem pełnej kompatybilności wstecznej.

**Wpisz "znajdź kamere w sieci lokalnej" i zacznij odkrywać swoje urządzenia!** 🎯
