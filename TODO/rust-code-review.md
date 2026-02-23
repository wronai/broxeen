# Code Review — motion_detection.rs & network_scan.rs

## Podsumowanie

Przeanalizowano 2358 linii kodu Rust. Znaleziono 4 problemy krytyczne, 5 ważnych i 3 drobne.

---

## 🔴 Krytyczne

---

### 1. SQL Injection — `motion_detection.rs`

**Problem:** Parametry do zapytań SQL są sklejane przez string formatting. Metoda `replace('\'', "''")` nie jest wystarczającą ochroną.

**Gdzie:** `motion_pipeline_stats()`, `motion_pipeline_detections()`

```rust
// ❌ TERAZ — niebezpieczne:
let where_clause = format!(
    "{} AND camera_id = '{}'",
    where_base,
    cam.replace('\'', "''")
);
```

```rust
// ✅ POWINNO BYĆ — parametryzowane zapytania (rusqlite params![]):
let mut stmt = conn.prepare(
    "SELECT COUNT(*) FROM detections
     WHERE timestamp > datetime('now', ? || ' hours')
     AND camera_id = ?"
)?;
let total: i64 = stmt.query_row(
    params![format!("-{}", hours), camera_id],
    |r| r.get(0)
).unwrap_or(0);
```

`rusqlite` ma makro `params![]` właśnie po to. Używaj go zawsze gdy wartości przychodzą z zewnątrz.

---

### 2. `LiveFrameCache` — 5 osobnych `Arc<Mutex<>>` — `network_scan.rs`

**Problem:** Pięć niezależnych locków na jedną logiczną strukturę. Każda operacja wymaga wielokrotnego lockowania. Ryzyko deadlocka, bardzo kosztowne alokacyjnie.

```rust
// ❌ TERAZ — 5 oddzielnych locków:
struct LiveFrameCache {
    last_jpeg:      Arc<Mutex<Option<Vec<u8>>>>,
    last_update_ms: Arc<Mutex<Option<u128>>>,
    last_error:     Arc<Mutex<Option<String>>>,
    frame_count:    Arc<Mutex<u64>>,
    started_at:     Arc<Mutex<Option<Instant>>>,
}

// Użycie — 5 osobnych sekcji krytycznych:
{ *cache.last_jpeg.lock().expect("...") = Some(frame); }
{ *cache.frame_count.lock().expect("...") += 1; }
{ *cache.last_update_ms.lock().expect("...") = Some(...); }
{ *cache.last_error.lock().expect("...") = None; }
```

```rust
// ✅ POWINNO BYĆ — jeden lock, atomowy update:
#[derive(Default)]
struct CacheInner {
    last_jpeg:      Option<Vec<u8>>,
    last_update_ms: Option<u128>,
    last_error:     Option<String>,
    frame_count:    u64,
    started_at:     Option<Instant>,
}

#[derive(Clone)]
struct LiveFrameCache(Arc<Mutex<CacheInner>>);

impl LiveFrameCache {
    fn update_frame(&self, jpeg: Vec<u8>, elapsed_ms: u128) {
        let mut inner = self.0.lock().unwrap_or_else(|e| e.into_inner());
        inner.last_jpeg = Some(jpeg);
        inner.frame_count += 1;
        inner.last_update_ms = Some(elapsed_ms);
        inner.last_error = None;
        // Jeden lock — wszystkie pola aktualizowane atomowo
    }

    fn set_error(&self, msg: String) {
        let mut inner = self.0.lock().unwrap_or_else(|e| e.into_inner());
        inner.last_error = Some(msg);
    }

    fn get_snapshot(&self) -> CacheInner {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }
}
```

---

### 3. Brak shutdown workerów RTSP — wyciek pamięci — `network_scan.rs`

**Problem:** `ensure_rtsp_worker()` tworzy wątki które nigdy nie kończą pracy. `RTSP_WORKERS` rośnie, stare workery nie są przerywane, ffmpeg procesy zostają w systemie.

```rust
// ❌ TERAZ — worker żyje wiecznie:
lazy_static! {
    static ref RTSP_WORKERS: Mutex<HashMap<String, RtspWorker>> = Mutex::new(HashMap::new());
}
// Brak komendy stop, brak mechanizmu przerwania
```

```rust
// ✅ POWINNO BYĆ — shutdown token:
use std::sync::atomic::{AtomicBool, Ordering};

struct RtspWorker {
    cache:     LiveFrameCache,
    url:       String,
    camera_id: String,
    shutdown:  Arc<AtomicBool>,   // ← dodać
}

// W ensure_rtsp_worker — przekaż do wątku:
let shutdown = Arc::new(AtomicBool::new(false));
let shutdown_clone = Arc::clone(&shutdown);

std::thread::spawn(move || {
    // Pętla zewnętrzna reconnect:
    while !shutdown_clone.load(Ordering::Relaxed) {
        // ... pętla odczytu klatek ...
        // Sprawdzaj shutdown wewnątrz pętli read
    }
});

// Nowy Tauri command:
#[tauri::command]
pub fn rtsp_stop_worker(camera_id: String, url: String) -> Result<(), String> {
    let key = format!("{}|{}", camera_id, url);
    let mut workers = RTSP_WORKERS.lock().map_err(|e| e.to_string())?;
    if let Some(worker) = workers.remove(&key) {
        worker.shutdown.store(true, Ordering::Relaxed);
    }
    Ok(())
}
```

---

### 4. Blokujące TCP connect w async context — `network_scan.rs`

**Problem:** `discover_onvif_cameras()` i `tcp_sweep()` są funkcjami `async`, ale wewnątrz wywołują `std::net::TcpStream::connect_timeout()` — blokującą operację. Blokuje wątek executora Tokio, uniemożliwiając obsługę innych zadań.

```rust
// ❌ TERAZ — blokuje executor:
async fn tcp_sweep(subnet: &str, timeout_ms: u64) -> Vec<ArpHost> {
    for i in 1..=254u8 {
        // connect_timeout jest BLOKUJĄCE — zatrzymuje cały executor:
        if TcpStream::connect_timeout(&addr, Duration::from_millis(...)).is_ok() {
            ...
        }
    }
}
```

```rust
// ✅ POWINNO BYĆ — tokio async connect, równoległe:
async fn tcp_sweep(subnet: &str, timeout_ms: u64) -> Vec<ArpHost> {
    const PORTS: &[u16] = &[80, 443, 22, 554, 8080];

    let tasks: Vec<_> = (1u8..=254)
        .map(|i| {
            let ip = format!("{}.{}", subnet, i);
            let per_host = timeout_ms / 50;
            tokio::spawn(async move {
                for &port in PORTS {
                    let addr = format!("{}:{}", ip, port);
                    let connect = tokio::net::TcpStream::connect(&addr);
                    if tokio::time::timeout(Duration::from_millis(per_host), connect)
                        .await
                        .is_ok_and(|r| r.is_ok())
                    {
                        return Some(ip);
                    }
                }
                None
            })
        })
        .collect();

    futures::future::join_all(tasks)
        .await
        .into_iter()
        .flatten()
        .flatten()
        .map(|ip| ArpHost {
            ip,
            mac: "unknown".to_string(),
            vendor: None,
            hostname: None,
            response_time: None,
        })
        .collect()
}
```

To samo dotyczy `discover_onvif_cameras()` — pętla 254 × 4 portów × blokujące connect.

---

## 🟡 Ważne

---

### 5. `lazy_static!` → `std::sync::OnceLock`

**Problem:** `lazy_static` to dodatkowa zależność. Od Rust 1.70 standardowa biblioteka ma `OnceLock`.

```rust
// ❌ TERAZ:
lazy_static::lazy_static! {
    static ref PIPELINES: Mutex<HashMap<String, PipelineProcess>> =
        Mutex::new(HashMap::new());
}
```

```rust
// ✅ POWINNO BYĆ — bez zewnętrznej zależności:
use std::sync::OnceLock;

static PIPELINES: OnceLock<Mutex<HashMap<String, PipelineProcess>>> = OnceLock::new();

fn pipelines() -> &'static Mutex<HashMap<String, PipelineProcess>> {
    PIPELINES.get_or_init(|| Mutex::new(HashMap::new()))
}

// Użycie:
let mut map = pipelines().lock().map_err(|e| e.to_string())?;
```

---

### 6. `find_jpeg_frame` — algorytm O(n²) — `network_scan.rs`

**Problem:** Dla każdej klatki pętla startuje od 0 szukając SOI, potem od znalezionego miejsca szukając EOI. Przy dużym buforze (wiele klatek naraz) jest to kosztowne.

```rust
// ❌ TERAZ — ręczne pętle, trudne do odczytania:
fn find_jpeg_frame(buffer: &[u8]) -> Option<(usize, usize)> {
    let mut soi: Option<usize> = None;
    let mut i = 0usize;
    while i + 1 < buffer.len() {
        if buffer[i] == 0xFF && buffer[i + 1] == 0xD8 {
            soi = Some(i);
            break;
        }
        i += 1;
    }
    let start = soi?;
    let mut j = start + 2;
    while j + 1 < buffer.len() {
        if buffer[j] == 0xFF && buffer[j + 1] == 0xD9 {
            return Some((start, j + 2));
        }
        j += 1;
    }
    None
}
```

```rust
// ✅ POWINNO BYĆ — idiomatyczne, czytelne, bez off-by-one:
fn find_jpeg_frame(buffer: &[u8]) -> Option<(usize, usize)> {
    let start = buffer
        .windows(2)
        .position(|w| w == [0xFF, 0xD8])?;       // SOI

    let end = buffer[start + 2..]
        .windows(2)
        .position(|w| w == [0xFF, 0xD9])          // EOI
        .map(|p| start + 2 + p + 2)?;

    Some((start, end))
}
```

---

### 7. `enrich_with_arp` — O(n×m) string search — `network_scan.rs`

**Problem:** Dla każdego urządzenia iteruje przez wszystkie linie ARP cache. Przy 50 urządzeniach i 100 liniach ARP = 5000 porównań.

```rust
// ❌ TERAZ — zagnieżdżona pętla:
fn enrich_with_arp(devices: &mut Vec<NetworkDevice>) {
    for device in devices.iter_mut() {
        for line in stdout.lines() {
            if line.contains(&device.ip) { ... }
        }
    }
}
```

```rust
// ✅ POWINNO BYĆ — parse ARP raz do HashMap, lookup O(1):
fn parse_arp_line(line: &str) -> Option<(String, Option<String>, Option<String>)> {
    let ip = line.split('(').nth(1)?.split(')').next()?.trim().to_string();
    let mac_str = line.split("at ").nth(1)?.split_whitespace().next()?.trim();
    if mac_str == "<incomplete>" || mac_str.is_empty() { return None; }
    let mac = Some(mac_str.to_string());
    let hostname = line.split_whitespace()
        .next()
        .filter(|s| *s != "?" && !s.starts_with('('))
        .map(|s| s.to_string());
    Some((ip, mac, hostname))
}

fn enrich_with_arp(devices: &mut [NetworkDevice]) {
    let Ok(out) = Command::new("arp").arg("-a").output() else { return };
    let stdout = String::from_utf8_lossy(&out.stdout);

    // Buduj mapę raz — O(m)
    let arp_map: HashMap<String, (Option<String>, Option<String>)> = stdout
        .lines()
        .filter_map(parse_arp_line)
        .map(|(ip, mac, hostname)| (ip, (mac, hostname)))
        .collect();

    // Lookup O(1) per device — O(n) łącznie
    for device in devices.iter_mut() {
        if let Some((mac, hostname)) = arp_map.get(&device.ip) {
            device.mac      = mac.clone();
            device.hostname = hostname.clone();
        }
    }
}
```

---

### 8. Duplikacja kodu execute_query — `motion_detection.rs`

**Problem:** Funkcje `vision_query()` i `vision_query_direct()` mają identyczne ~20 linii budowania wyników z rusqlite.

```rust
// ❌ TERAZ — skopiowany blok w dwóch miejscach (ryzyko desync):
let col_names: Vec<String> = stmt.column_names()
    .into_iter().map(String::from).collect();
let rows: Vec<Vec<String>> = stmt.query_map([], |row| {
    let n = row.as_ref().column_count();
    let mut vals = Vec::with_capacity(n);
    for i in 0..n {
        let v = match row.get_ref(i) {
            Ok(rusqlite::types::ValueRef::Null)       => "—".into(),
            // ... ten sam kod w obu funkcjach
        };
        vals.push(v);
    }
    Ok(vals)
})...
```

```rust
// ✅ POWINNO BYĆ — wspólna funkcja pomocnicza:
fn format_cell(val: rusqlite::types::ValueRef) -> String {
    use rusqlite::types::ValueRef::*;
    match val {
        Null       => "—".into(),
        Integer(i) => i.to_string(),
        Real(f)    => format!("{:.2}", f),
        Text(t)    => String::from_utf8_lossy(t).into_owned(),
        Blob(b)    => format!("[BLOB {}B]", b.len()),
    }
}

fn execute_select(
    conn: &rusqlite::Connection,
    sql: &str,
) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
    let mut stmt = conn.prepare(sql)
        .map_err(|e| format!("SQL error: {e} — query: {sql}"))?;

    let columns: Vec<String> = stmt.column_names()
        .into_iter().map(String::from).collect();

    let rows: Vec<Vec<String>> = stmt
        .query_map([], |row| {
            let n = row.as_ref().column_count();
            (0..n).map(|i| Ok(format_cell(row.get_ref(i).unwrap_or(ValueRef::Null))))
                  .collect()
        })
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .collect();

    Ok((columns, rows))
}

// vision_query i vision_query_direct wywołują execute_select() zamiast duplikować kod
```

---

### 9. `classify_device` — `Vec::contains` O(n) — `network_scan.rs`

```rust
// ❌ TERAZ — wielokrotne .contains() na Vec<u16>:
let has_rtsp = ports.contains(&554) || ports.contains(&8554) || ports.contains(&10554);
let has_web  = ports.contains(&80)  || ports.contains(&81)   || ports.contains(&82) || ...;
```

```rust
// ✅ POWINNO BYĆ — HashSet raz, stałe tablice:
fn classify_device(ports: &[u16]) -> &'static str {
    use std::collections::HashSet;
    let set: HashSet<u16> = ports.iter().copied().collect();

    const RTSP_PORTS: &[u16] = &[554, 8554, 10554];
    const HIK_PORTS:  &[u16] = &[8000, 8899];
    const WEB_PORTS:  &[u16] = &[80, 81, 82, 83, 443, 8080, 8081, 8443, 8888];

    let has = |list: &[u16]| list.iter().any(|p| set.contains(p));

    if has(RTSP_PORTS) || (has(HIK_PORTS) && has(WEB_PORTS)) {
        "camera"
    } else if set.contains(&1883) || set.contains(&9001) {
        "iot-broker"
    } else if set.contains(&22) {
        "server"
    } else if has(WEB_PORTS) {
        "web-device"
    } else {
        "unknown"
    }
}
```

---

## 🟢 Drobne / styl

---

### 10. `expect("lock poisoned")` — 30+ wywołań — `network_scan.rs`

**Problem:** Każdy dostęp do Mutex kończy się `.expect("xxx lock poisoned")`. 30+ różnych string literałów. Jeśli lock jest poisoned, lepiej wyciągnąć dane niż panikować.

```rust
// ❌ TERAZ — panika przy poisoned lock:
*cache.last_jpeg.lock().expect("last_jpeg lock poisoned") = Some(frame);
*cache.frame_count.lock().expect("frame_count lock poisoned") += 1;
// ... 28 razy więcej
```

```rust
// ✅ POWINNO BYĆ — helper trait, recover from poisoned lock:
trait LockExt<T> {
    fn acquire(&self) -> std::sync::MutexGuard<T>;
}

impl<T> LockExt<T> for std::sync::Mutex<T> {
    fn acquire(&self) -> std::sync::MutexGuard<T> {
        // Przy poisoned lock wyciąga dane zamiast panikować
        self.lock().unwrap_or_else(|e| e.into_inner())
    }
}

// Użycie — zamiast .lock().expect("..."):
*cache.last_jpeg.acquire() = Some(frame);
*cache.frame_count.acquire() += 1;
```

---

### 11. Hardkodowane wymiary klatki — `network_scan.rs`

**Problem:** `rtsp_capture_frame()` zwraca `width: 1920, height: 1080` bez weryfikacji. Jeśli kamera nagrywa 1280×720 lub 2560×1440 — frontend dostaje złe metadane.

```rust
// ❌ TERAZ — hardkodowane:
return Ok(CapturedFrame {
    base64: general_purpose::STANDARD.encode(&jpeg),
    width: 1920,   // ← zawsze 1920, niezależnie od kamery
    height: 1080,  // ← zawsze 1080
    ...
});
```

```rust
// ✅ POWINNO BYĆ — wyciągnij z JPEG SOF0 markera:
fn jpeg_dimensions(data: &[u8]) -> (u32, u32) {
    // SOF0/SOF2 marker: FF C0 lub FF C2, potem 3 bajty, potem u16 height, u16 width
    let mut i = 2usize;
    while i + 8 < data.len() {
        if data[i] == 0xFF && (data[i+1] == 0xC0 || data[i+1] == 0xC2) {
            let h = u16::from_be_bytes([data[i+5], data[i+6]]) as u32;
            let w = u16::from_be_bytes([data[i+7], data[i+8]]) as u32;
            if w > 0 && h > 0 { return (w, h); }
        }
        i += 1;
    }
    (0, 0) // unknown
}

// Użycie:
let (width, height) = jpeg_dimensions(&jpeg);
return Ok(CapturedFrame { base64: ..., width, height, ... });
```

---

### 12. `now_ms()` zdefiniowane globalnie, używane tylko w jednym cfg bloku — `motion_detection.rs`

```rust
// ❌ TERAZ — kompiluje się w obu wersjach ale używana tylko bez feature "vision":
fn now_ms() -> u64 { ... }  // globalna

// ✅ POWINNO BYĆ:
#[cfg(not(feature = "vision"))]
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
```

---

## Tabela priorytetów

| # | Problem | Plik | Priorytet | Wpływ |
|---|---------|------|-----------|-------|
| 1 | SQL Injection — `params![]` zamiast format! | motion_detection.rs | 🔴 Krytyczny | Bezpieczeństwo |
| 2 | `LiveFrameCache` — 5 Mutex → jeden | network_scan.rs | 🔴 Krytyczny | Deadlock, wydajność |
| 3 | Brak shutdown workerów RTSP | network_scan.rs | 🔴 Krytyczny | Wyciek pamięci |
| 4 | Blokujące TCP w async | network_scan.rs | 🔴 Krytyczny | Zawieszenie executor |
| 5 | `lazy_static` → `OnceLock` | oba | 🟡 Ważny | Zależności |
| 6 | `find_jpeg_frame` O(n²) → O(n) | network_scan.rs | 🟡 Ważny | Wydajność |
| 7 | `enrich_with_arp` HashMap | network_scan.rs | 🟡 Ważny | Wydajność |
| 8 | Duplikacja execute_query | motion_detection.rs | 🟡 Ważny | Maintainability |
| 9 | `classify_device` HashSet | network_scan.rs | 🟡 Ważny | Wydajność |
| 10 | `expect` → LockExt helper | network_scan.rs | 🟢 Drobny | Stabilność |
| 11 | Hardkodowane 1920×1080 | network_scan.rs | 🟢 Drobny | Correctness |
| 12 | `now_ms()` cfg guard | motion_detection.rs | 🟢 Drobny | Kompilacja |
