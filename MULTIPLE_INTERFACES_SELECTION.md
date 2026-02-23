# Wybór interfejsu sieciowego - Multiple Interfaces

## Problem

Gdy komputer ma **wiele interfejsów sieciowych** (np. WiFi + Ethernet + Docker), system nie wie, który użyć do skanowania.

**Przykład:**
```bash
$ ip a
wlp90s0: inet 192.168.188.152/24  # WiFi - aktywny
enp91s0: DOWN                      # Ethernet - nieaktywny
docker0: inet 172.17.0.1/16        # Docker
```

## Rozwiązanie

System automatycznie wykrywa wszystkie interfejsy i:
1. **Jeden interfejs** → używa go automatycznie
2. **Wiele interfejsów** → automatycznie wybiera najlepszy (preferuje prywatne IP + fizyczne/WiFi, odrzuca docker/tun)

## Jak to działa

### 1. Automatyczna detekcja (1 interfejs)

**Komenda:**
```
pokaż kamery
```

**System wykrywa:**
```
[NetworkScanPlugin] Found 1 network interfaces: [["wlp90s0", "192.168.188.152"]]
[NetworkScanPlugin] ✅ Tauri detected: IP=192.168.188.152, subnet=192.168.188, interface=wlp90s0
```

**Wynik:**
```
🌐 Podsieć: 192.168.188.0/24 (wykryta: Tauri (wlp90s0))
```

### 2. Wybór interfejsu (wiele interfejsów)

**Komenda:**
```
pokaż kamery
```

**System wykrywa:**
```
[NetworkScanPlugin] Found 3 network interfaces:
  - wlp90s0: 192.168.188.152
  - enp91s0: 192.168.1.100
  - docker0: 172.17.0.1
```

**Wynik (auto):**
```
🌐 Podsieć: 192.168.188.0/24 (wykryta: Tauri (wlp90s0))
```

### 3. Bezpośredni wybór podsieci

**Komenda:**
```
pokaż kamery 192.168.188
```

**System:**
```
[NetworkScanPlugin] User specified subnet: 192.168.188
[NetworkScanPlugin] Using user-specified subnet: 192.168.188
```

**Wynik:**
```
🌐 Podsieć: 192.168.188.0/24 (wykryta: user-specified)
[skanowanie 192.168.188.0/24...]
```

## Inline Action Hints

Wszystkie sugestie są **klikalne** dzięki Inline Action Hints:

`Chat.tsx` renderuje przyciski pod wiadomością, a surowa lista `- "..." — ...` nie jest pokazywana w treści markdown (tekst jest ucinany w miejscu markera `Sugerowane akcje`).

```
💡 Sugerowane akcje:
- "pokaż kamery 192.168.188" — Skanuj wlp90s0 (192.168.188.152)
```

Renderowane jako:
```
[⚡ Skanuj wlp90s0 (192.168.188.152)] ← klikalny przycisk
```

Uwagi:
- maksymalnie renderuje się 10 przycisków
- jeśli komenda wygląda na szablon (np. zawiera `HASŁO`), kliknięcie prefilluje input

## Implementacja

### Frontend (networkScanPlugin.ts)

**1. Wykrywanie interfejsów:**
```typescript
const interfaces = await invoke('list_network_interfaces');
// [["wlp90s0", "192.168.188.152"], ["docker0", "172.17.0.1"]]

if (interfaces.length === 1) {
  // Użyj automatycznie
  const [ifaceName, ip] = interfaces[0];
  const subnet = ip.split('.').slice(0, 3).join('.');
  return { localIp: ip, subnet, detectionMethod: `Tauri (${ifaceName})` };
} else if (interfaces.length > 1) {
  // Poproś użytkownika o wybór
  return { detectionMethod: 'user-selection-required', interfaces };
}
```

**2. Ekstrakcja podsieci z komendy:**
```typescript
const subnetMatch = input.match(/(\d{1,3}\.\d{1,3}\.\d{1,3})/);
const userSpecifiedSubnet = subnetMatch ? subnetMatch[1] : null;

if (userSpecifiedSubnet) {
  // Użyj podanej podsieci
  subnet = userSpecifiedSubnet;
  detectionMethod = 'user-specified';
}
```

**3. Generowanie UI wyboru:**
```typescript
if (detectionMethod === 'user-selection-required') {
  const lines = ['🌐 **Wykryto wiele interfejsów sieciowych**\n'];
  
  interfaces.forEach(([ifaceName, ip], index) => {
    const subnet = ip.split('.').slice(0, 3).join('.');
    lines.push(`**${index + 1}. ${ifaceName}** — ${ip} (podsieć: ${subnet}.0/24)`);
    lines.push(`   💬 Skanuj: *"skanuj ${subnet}"* lub *"pokaż kamery ${subnet}"*\n`);
  });
  
  lines.push('💡 **Sugerowane akcje:**');
  interfaces.forEach(([ifaceName, ip]) => {
    const subnet = ip.split('.').slice(0, 3).join('.');
    lines.push(`- "pokaż kamery ${subnet}" — Skanuj ${ifaceName} (${ip})`);
  });
  
  return { content: [{ type: 'text', data: lines.join('\n') }] };
}
```

### Backend (network_info.rs)

**Komenda Rust:**
```rust
#[tauri::command]
pub fn list_network_interfaces() -> Result<Vec<(String, String)>, String> {
    use local_ip_address::list_afinet_netifas;
    
    match list_afinet_netifas() {
        Ok(interfaces) => {
            let result: Vec<(String, String)> = interfaces
                .iter()
                .filter_map(|(name, ip)| {
                    // Filtruj loopback i IPv6
                    if name != "lo" && matches!(ip, IpAddr::V4(_)) {
                        Some((name.clone(), ip.to_string()))
                    } else {
                        None
                    }
                })
                .collect();
            Ok(result)
        }
        Err(e) => Err(format!("Failed to list network interfaces: {}", e)),
    }
}
```

## Przypadki użycia

### Scenariusz 1: Laptop z WiFi (1 interfejs)

```
Użytkownik: "pokaż kamery"
System: [wykrywa wlp90s0: 192.168.188.152]
System: [automatycznie skanuje 192.168.188.0/24]
```

### Scenariusz 2: Desktop z WiFi + Ethernet (2 interfejsy)

```
Użytkownik: "pokaż kamery"
System: [wykrywa wlp90s0 + enp91s0]
System: [pokazuje wybór interfejsów]
Użytkownik: [klika "⚡ Skanuj wlp90s0"]
System: [wykonuje "pokaż kamery 192.168.188"]
System: [skanuje 192.168.188.0/24]
```

### Scenariusz 3: Developer z Docker (3+ interfejsy)

```
Użytkownik: "pokaż kamery"
System: [wykrywa wlp90s0 + docker0 + veth...]
System: [pokazuje wybór interfejsów]
Użytkownik: "pokaż kamery 192.168.188"
System: [skanuje 192.168.188.0/24 bezpośrednio]
```

### Scenariusz 4: Bezpośrednie podanie podsieci

```
Użytkownik: "skanuj 10.0.0"
System: [pomija detekcję, używa 10.0.0]
System: [skanuje 10.0.0.0/24]
```

## Zalety

✅ **Automatyczne** - jeden interfejs = zero kliknięć  
✅ **Interaktywne** - wiele interfejsów = wybór użytkownika  
✅ **Elastyczne** - można podać podsieć bezpośrednio  
✅ **Klikalne** - wszystkie sugestie jako przyciski  
✅ **Informacyjne** - pokazuje nazwę interfejsu i IP  

## Testowanie

### Test 1: Jeden interfejs

```bash
# Symuluj jeden interfejs
corepack pnpm tauri dev
```

```
pokaż kamery
```

**Oczekiwany wynik:**
```
🌐 Podsieć: 192.168.188.0/24 (wykryta: Tauri (wlp90s0))
```

### Test 2: Wiele interfejsów

```bash
# Uruchom Docker (dodaje docker0)
sudo systemctl start docker
corepack pnpm tauri dev
```

```
pokaż kamery
```

**Oczekiwany wynik:**
```
🌐 **Wykryto wiele interfejsów sieciowych**
[lista interfejsów z action hints]
```

### Test 3: Bezpośrednia podsieć

```
pokaż kamery 192.168.188
```

**Oczekiwany wynik:**
```
🌐 Podsieć: 192.168.188.0/24 (wykryta: user-specified)
```

## Logi diagnostyczne

```
[NetworkScanPlugin] Starting subnet detection...
[NetworkScanPlugin] Trying Tauri backend network detection...
[NetworkScanPlugin] Found 2 network interfaces: [["wlp90s0","192.168.188.152"],["docker0","172.17.0.1"]]
[NetworkScanPlugin] Multiple interfaces detected, prompting user...
```

## Podsumowanie

**Problem:** Wiele interfejsów → system nie wie, który użyć  
**Rozwiązanie:** Automatyczna detekcja + wybór użytkownika + bezpośrednie podanie podsieci  
**UX:** Klikalne action hints dla szybkiego wyboru  
**Backend:** Rust czyta interfejsy z OS (100% niezawodne)  

System jest **inteligentny** (automatyczny dla 1 interfejsu) i **elastyczny** (wybór dla wielu interfejsów).
