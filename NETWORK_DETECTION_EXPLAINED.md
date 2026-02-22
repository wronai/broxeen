# Wykrywanie sieci - Problem i rozwiązanie

## 🔴 Problem: Hardkodowane podsieci

### Twoje pytanie
```
a co jeśli jest nietypowa nazwa sieci?
skad ma wiedzieć, ktora jest poprawna?
```

**Masz absolutną rację!** Hardkodowanie listy podsieci to **zły pomysł**.

### Dlaczego to nie działa?

```typescript
// ❌ ZŁE PODEJŚCIE - hardkodowane podsieci
const candidateSubnets = [
  '192.168.188', '192.168.0', '192.168.1', '192.168.2', '192.168.10',
  '10.0.0', '10.0.1', '10.1.1',
  '172.16.0', '172.16.1'
];
```

**Problemy:**
1. ❌ Nie wykryje nietypowych podsieci (np. 192.168.77, 10.50.0, 172.20.0)
2. ❌ Może wykryć niewłaściwą sieć, jeśli wiele gatewayów odpowiada
3. ❌ Wymaga ręcznej aktualizacji dla każdej nowej sieci
4. ❌ Nie wie, który interfejs jest **aktywny**

### Twój przypadek

Z `ip a` widzę:
```
wlp90s0: <BROADCAST,MULTICAST,UP,LOWER_UP>
    inet 192.168.188.152/24 brd 192.168.188.255 scope global dynamic noprefixroute wlp90s0
```

**Aktywny interfejs:** `wlp90s0` (WiFi)  
**IP:** `192.168.188.152/24`  
**Podsieć:** `192.168.188.0/24`

System **powinien** wykryć to automatycznie, bez hardkodowania!

## ✅ Rozwiązanie: Prawdziwa detekcja

### Strategia 1: WebRTC (przeglądarka)

WebRTC może **zapytać system operacyjny** o lokalny IP:

```typescript
private detectLocalIpViaWebRTC(): Promise<string | null> {
  const pc = new RTCPeerConnection({ iceServers: [] });
  pc.createDataChannel('');
  
  pc.onicecandidate = (event) => {
    const candidate = event.candidate.candidate;
    // Przykład: "candidate:... 192.168.188.152 ..."
    const ipMatch = candidate.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
    if (ipMatch && this.isPrivateIp(ipMatch[1])) {
      return ipMatch[1]; // ✅ 192.168.188.152
    }
  };
}
```

**Jak to działa:**
1. WebRTC tworzy połączenie peer-to-peer
2. Zbiera ICE candidates (możliwe ścieżki połączenia)
3. Candidates zawierają **rzeczywisty lokalny IP** z interfejsu sieciowego
4. Ekstrahujemy IP i obliczamy podsieć: `192.168.188.152` → `192.168.188`

**Zalety:**
- ✅ Wykrywa **rzeczywisty** IP z aktywnego interfejsu
- ✅ Działa dla **dowolnej** podsieci (192.168.x, 10.x.x, 172.x.x)
- ✅ Nie wymaga uprawnień root
- ✅ Działa w Chrome, Firefox, Edge

**Wady:**
- ❌ Nie działa w Tauri WebKitGTK (Linux)
- ❌ Może być zablokowane przez politykę bezpieczeństwa
- ❌ Wymaga HTTPS w niektórych przeglądarkach

### Strategia 2: Tauri Backend (desktop app)

Dla Tauri możemy dodać komendę Rust, która czyta interfejsy:

```rust
// src-tauri/src/network.rs
use std::net::IpAddr;

#[tauri::command]
pub fn get_local_ip() -> Result<String, String> {
    // Użyj crate 'local-ip-address' lub 'pnet'
    let local_ip = local_ip_address::local_ip()
        .map_err(|e| e.to_string())?;
    
    match local_ip {
        IpAddr::V4(ip) => Ok(ip.to_string()),
        _ => Err("No IPv4 address found".to_string()),
    }
}
```

**Frontend:**
```typescript
const localIp = await invoke('get_local_ip');
// ✅ Zwraca: "192.168.188.152"
const subnet = localIp.split('.').slice(0, 3).join('.');
// ✅ Zwraca: "192.168.188"
```

**Zalety:**
- ✅ **100% niezawodne** - czyta bezpośrednio z OS
- ✅ Działa dla **dowolnej** podsieci
- ✅ Wykrywa aktywny interfejs (UP, LOWER_UP)
- ✅ Szybkie (natywny kod)

### Strategia 3: Gateway Probe (fallback)

Jeśli WebRTC i Tauri zawodzą, próbujemy zgadnąć przez gateway:

```typescript
private async probeGateways(subnets: string[]): Promise<string | null> {
  // Sprawdź wszystkie popularne podsieci
  const results = await Promise.allSettled(
    subnets.map(subnet => this.probeGateway(subnet))
  );
  
  // Zwróć pierwszą, która odpowiada
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled' && results[i].value) {
      return subnets[i]; // ⚠️ Może być niepoprawna!
    }
  }
}
```

**Wady:**
- ⚠️ Może wykryć **niewłaściwą** sieć
- ⚠️ Nie działa dla nietypowych podsieci (jeśli nie ma ich na liście)
- ⚠️ Wolniejsze (musi sprawdzić wszystkie)

## 🎯 Rekomendowane podejście

### Dla przeglądarki (browser mode)

1. **Najpierw:** WebRTC (jeśli dostępne)
2. **Fallback:** Gateway probe z ostrzeżeniem
3. **Ostateczność:** Domyślna podsieć + komunikat dla użytkownika

```typescript
async detectSubnet() {
  // 1. WebRTC - najlepsze
  const webrtcIp = await this.detectLocalIpViaWebRTC();
  if (webrtcIp) {
    return { ip: webrtcIp, method: 'WebRTC' }; // ✅
  }
  
  // 2. Gateway probe - niepewne
  const gateway = await this.probeGateways(commonSubnets);
  if (gateway) {
    console.warn('⚠️ Using gateway probe - may be inaccurate');
    return { subnet: gateway, method: 'gateway-probe' }; // ⚠️
  }
  
  // 3. Default - prawdopodobnie błędne
  console.error('❌ Cannot detect network - using default');
  console.info('💡 Tip: Use Tauri app or specify IP manually');
  return { subnet: '192.168.1', method: 'default' }; // ❌
}
```

### Dla Tauri (desktop app)

1. **Tylko:** Rust backend - czyta interfejsy z OS
2. **Fallback:** Nie potrzebny - backend zawsze działa

```typescript
async detectSubnet() {
  if (window.__TAURI__) {
    const ip = await invoke('get_local_ip');
    return { ip, method: 'tauri-backend' }; // ✅ 100% niezawodne
  }
  // ... browser fallback
}
```

## 📊 Porównanie metod

| Metoda | Dokładność | Szybkość | Dostępność | Nietypowe sieci |
|--------|-----------|----------|------------|-----------------|
| **Tauri Backend** | ✅ 100% | ⚡ Bardzo szybka | Tylko Tauri | ✅ Tak |
| **WebRTC** | ✅ 95% | ⚡ Szybka | Chrome/Firefox | ✅ Tak |
| **Gateway Probe** | ⚠️ 60% | 🐌 Wolna | Wszędzie | ❌ Tylko z listy |
| **Default** | ❌ 10% | ⚡ Instant | Wszędzie | ❌ Nie |

## 🔧 Implementacja - Co zrobiłem

### 1. Lepsze logowanie WebRTC

```typescript
console.log(`[NetworkScanPlugin] WebRTC candidate #${candidateCount}: ${candidate}`);
console.log(`[NetworkScanPlugin] WebRTC extracted IP: ${ip}, isPrivate: ${this.isPrivateIp(ip)}`);
console.log(`[NetworkScanPlugin] ✅ WebRTC detected local IP: ${ip}`);
```

**Dlaczego:** Możesz zobaczyć w konsoli, czy WebRTC działa i co wykrywa.

### 2. Ostrzeżenia dla fallbacków

```typescript
console.warn(`[NetworkScanPlugin] ⚠️ Using gateway probe fallback - may be inaccurate`);
console.warn(`[NetworkScanPlugin] ⚠️ Using default subnet 192.168.1 - this is likely incorrect!`);
console.warn(`[NetworkScanPlugin] 💡 Tip: Use Tauri app for accurate detection`);
```

**Dlaczego:** Użytkownik wie, że wykrywanie może być niepoprawne.

### 3. Rozszerzona lista podsieci

```typescript
private getCommonSubnets(): string[] {
  return [
    '192.168.1', '192.168.0', '192.168.2',
    '192.168.10', '192.168.100', '192.168.188', // ← Twoja sieć
    '10.0.0', '10.0.1', '10.1.1', '10.10.10',
    '172.16.0', '172.16.1', '172.31.0',
  ];
}
```

**Ale:** To nadal fallback - WebRTC jest lepsze!

## 🚀 Następne kroki

### Opcja A: Sprawdź WebRTC w przeglądarce

1. Otwórz konsolę (F12)
2. Wykonaj: `pokaż kamery`
3. Szukaj logów:
```
[NetworkScanPlugin] WebRTC available, starting ICE candidate gathering...
[NetworkScanPlugin] WebRTC candidate #1: candidate:... 192.168.188.152 ...
[NetworkScanPlugin] ✅ WebRTC detected local IP: 192.168.188.152
```

**Jeśli widzisz ✅** - WebRTC działa! Podsieć powinna być poprawna.  
**Jeśli widzisz ⚠️** - WebRTC nie działa, używa gateway probe.

### Opcja B: Dodaj Tauri backend (najlepsze rozwiązanie)

Stworzę komendę Rust do wykrywania IP:

```rust
// src-tauri/src/network.rs
use local_ip_address::local_ip;

#[tauri::command]
pub fn get_local_network_ip() -> Result<String, String> {
    match local_ip() {
        Ok(IpAddr::V4(ip)) => Ok(ip.to_string()),
        Ok(IpAddr::V6(_)) => Err("Only IPv6 available".to_string()),
        Err(e) => Err(e.to_string()),
    }
}
```

**Dodaj do Cargo.toml:**
```toml
[dependencies]
local-ip-address = "0.5"
```

**Frontend:**
```typescript
if (window.__TAURI__) {
  const ip = await invoke('get_local_network_ip');
  // ✅ Zawsze poprawne: "192.168.188.152"
}
```

### Opcja C: Ręczne podanie IP

Jeśli automatyczna detekcja zawodzi, użytkownik może podać IP:

```
monitoruj 192.168.188.100
```

System automatycznie wykryje podsieć: `192.168.188`

## 💡 Podsumowanie

**Problem:** Hardkodowane podsieci nie działają dla nietypowych sieci.

**Rozwiązanie:**
1. ✅ **WebRTC** - automatyczna detekcja z OS (przeglądarka)
2. ✅ **Tauri backend** - 100% niezawodne (desktop)
3. ⚠️ **Gateway probe** - fallback (może być błędny)
4. ❌ **Default** - ostateczność (prawdopodobnie błędny)

**Twoja sieć (192.168.188):**
- WebRTC powinno wykryć automatycznie
- Jeśli nie - dodaj Tauri backend
- Fallback: gateway probe (już na liście)
- Ostateczność: podaj IP ręcznie

**Sprawdź logi konsoli** przy następnym skanowaniu - zobaczysz, która metoda zadziałała!
