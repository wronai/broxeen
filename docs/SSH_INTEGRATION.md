# SSH Integration - Pełna Dokumentacja

## ✅ Potwierdzenie Funkcjonalności

**TAK** - obsługa SSH działa w pełni i obsługuje wszystkie wymagane scenariusze:

1. ✅ Połączenie ze zdalnym/lokalnym hostem
2. ✅ Wykonywanie operacji przez komendy głosowe
3. ✅ Odpowiedzi z analizą LLM
4. ✅ Generowanie komend przez LLM
5. ✅ Text2SSH - tłumaczenie języka naturalnego na komendy

## Architektura

### Frontend (`src/plugins/system/sshPlugin.ts`)

Plugin SSH obsługuje:
- **Intenty**: `ssh:execute`, `ssh:connect`, `ssh:test`, `ssh:hosts`
- **Scopes**: `local`, `network`
- **Text2SSH**: 14 predefiniowanych wzorców języka naturalnego

#### Przykładowe wzorce Text2SSH:

```typescript
{
  patterns: [/uptime/i, /jak\s+dług/i, /od\s+kiedy\s+dział/i],
  command: 'uptime',
  description: 'Czas działania systemu',
}
{
  patterns: [/dysk|disk|miejsce|storage|df/i],
  command: 'df -h --output=source,target,size,used,avail,pcent -x tmpfs -x devtmpfs',
  description: 'Użycie dysków',
}
{
  patterns: [/pamięć|memory|ram|free/i],
  command: 'free -h',
  description: 'Użycie pamięci RAM',
}
```

### Backend (`src-tauri/src/ssh.rs`)

Rust backend zapewnia:
- `ssh_execute` - wykonywanie komend SSH
- `ssh_test_connection` - test połączenia TCP + SSH
- `ssh_list_known_hosts` - lista hostów z `~/.ssh/known_hosts`

### LLM Integration (`src/hooks/useLlm.ts`)

Hook `useLlm` zapewnia:
- Analizę wyników SSH przez LLM
- Generowanie komend SSH z języka naturalnego
- Detekcję intencji użytkownika
- Kontekst konwersacji (historia)

## Przykłady Użycia

### 1. Bezpośrednie Komendy SSH

```bash
# Podstawowa komenda
ssh 192.168.1.100 uptime

# Z parametrami użytkownika i portu
ssh 192.168.1.100 user admin port 2222 df -h

# Złożona komenda
ssh 10.0.0.1 "ps aux | grep nginx"
```

### 2. Text2SSH - Język Naturalny

```bash
# Polski
text2ssh 192.168.1.100 ile pamięci
text2ssh 192.168.1.100 sprawdź dysk
text2ssh 192.168.1.100 jakie procesy działają
text2ssh 192.168.1.100 kto jest zalogowany

# Angielski
text2ssh 192.168.1.100 check memory
text2ssh 192.168.1.100 show disk usage
text2ssh 192.168.1.100 what processes are running
```

### 3. Komendy Głosowe

```
"Sprawdź dysk na serwerze 192.168.1.100"
"Ile pamięci ma host 10.0.0.1"
"Pokaż procesy na lokalnym hoście"
"Jaka jest temperatura serwera"
```

### 4. Test Połączenia

```bash
test ssh 192.168.1.100
test ssh 192.168.1.100 user admin port 2222
```

### 5. Lista Znanych Hostów

```bash
ssh hosty
ssh hosts
```

## Integracja z LLM

### Scenariusz 1: Analiza Wyników

```
Użytkownik: "ssh 192.168.1.100 df -h"
System: [wykonuje komendę, pokazuje wynik]
Użytkownik: "Co to znaczy?"
LLM: "Wynik pokazuje użycie dysków. Dysk główny (/) ma 85% wykorzystania..."
```

### Scenariusz 2: Generowanie Komend

```
Użytkownik: "Sprawdź czy serwer 192.168.1.100 ma dużo wolnej pamięci"
LLM: [wykrywa intent SSH]
System: [wykonuje: ssh 192.168.1.100 free -h]
LLM: "Serwer ma 8GB wolnej pamięci z 16GB całkowitej..."
```

### Scenariusz 3: Diagnostyka

```
Użytkownik: "Dlaczego serwer jest wolny?"
LLM: "Sprawdzę obciążenie CPU i pamięć..."
System: [wykonuje: ssh host top -bn1 | head -20]
LLM: "Widzę że proces nginx zajmuje 80% CPU..."
```

## Testy Docker

### Setup

```bash
# Uruchom środowisko testowe SSH
pnpm run ssh:setup

# Lub ręcznie
cd docker/ssh-test
chmod +x setup.sh
./setup.sh
```

### Dostępne Serwery

- **Server 1**: `localhost:2222`
- **Server 2**: `localhost:2223`
- **User**: `testuser`
- **Password**: `testpass`
- **SSH Key**: `docker/ssh-test/id_rsa`

### Uruchamianie Testów

```bash
# Wszystkie testy SSH
pnpm run test:e2e:ssh

# Testy integracyjne (bez Docker)
pnpm run test:e2e e2e/ssh-integration.spec.ts

# Testy z Docker
pnpm run test:e2e e2e/ssh-docker.spec.ts

# UI mode
pnpm run test:e2e:ui
```

### Ręczne Testowanie

```bash
# Połącz się z serwerem testowym
ssh -i docker/ssh-test/id_rsa -p 2222 testuser@localhost

# Lub z hasłem
ssh -p 2222 testuser@localhost
# Password: testpass

# Test komend
ssh -i docker/ssh-test/id_rsa -p 2222 testuser@localhost uptime
ssh -i docker/ssh-test/id_rsa -p 2222 testuser@localhost df -h
ssh -i docker/ssh-test/id_rsa -p 2222 testuser@localhost free -h
```

## Konfiguracja

### ConfigStore (`src/config/appConfig.ts`)

```typescript
ssh: {
  defaultUser: 'root',
  defaultPort: 22,
  defaultTimeoutSec: 10,
}
```

### Zmiana Konfiguracji

```bash
# W aplikacji
konfiguruj ssh

# Lub programowo
import { configStore } from './config/configStore';
configStore.set('ssh.defaultUser', 'admin');
configStore.set('ssh.defaultPort', 2222);
```

## Bezpieczeństwo

### Uwagi Bezpieczeństwa

1. **Klucze SSH**: Plugin używa kluczy SSH z `~/.ssh/` (BatchMode=yes)
2. **StrictHostKeyChecking**: Wyłączone dla wygody (można włączyć)
3. **Timeout**: Domyślnie 10s, można konfigurować
4. **Niebezpieczne komendy**: Restart/reboot wymagają potwierdzenia

### Rekomendacje

```bash
# Użyj kluczy SSH zamiast haseł
ssh-keygen -t ed25519 -C "broxeen@$(hostname)"
ssh-copy-id -i ~/.ssh/id_ed25519.pub user@host

# Ogranicz dostęp w ~/.ssh/authorized_keys
command="/usr/local/bin/safe-commands.sh" ssh-ed25519 AAAA...
```

## Rozwiązywanie Problemów

### SSH nie działa w przeglądarce

**Problem**: `Wykonanie SSH wymaga trybu Tauri`

**Rozwiązanie**: SSH wymaga natywnego dostępu do systemu, uruchom aplikację Tauri:
```bash
pnpm tauri dev
```

### Permission denied (publickey)

**Problem**: Brak autoryzacji SSH

**Rozwiązanie**:
```bash
# Sprawdź klucze
ls -la ~/.ssh/

# Wygeneruj nowy klucz
ssh-keygen -t ed25519

# Skopiuj na serwer
ssh-copy-id user@host
```

### Connection timeout

**Problem**: Host nieosiągalny

**Rozwiązanie**:
```bash
# Sprawdź połączenie
ping host

# Sprawdź port SSH
nc -zv host 22

# Test połączenia w Broxeen
test ssh host
```

### Text2SSH nie rozpoznaje komendy

**Problem**: Wzorzec nie pasuje

**Rozwiązanie**: Użyj bezpośredniej komendy:
```bash
ssh host "twoja komenda"
```

Lub dodaj nowy wzorzec w `sshPlugin.ts`:
```typescript
{
  patterns: [/twój wzorzec/i],
  command: 'twoja komenda',
  description: 'Opis',
}
```

## Pokrycie Testami

### Unit Tests (`src/plugins/system/sshPlugin.test.ts`)

- ✅ Metadata pluginu
- ✅ Detekcja intencji (`canHandle`)
- ✅ Wykonywanie komend SSH
- ✅ Text2SSH translation
- ✅ Lista znanych hostów
- ✅ Test połączenia
- ✅ Obsługa błędów

### E2E Tests (`e2e/ssh-integration.spec.ts`)

- ✅ Rejestracja pluginu
- ✅ Text2SSH w UI
- ✅ Sugestie akcji
- ✅ Analiza LLM
- ✅ Obsługa błędów
- ✅ Kontekst konwersacji

### Docker Integration Tests (`e2e/ssh-docker.spec.ts`)

- ✅ Rzeczywiste połączenia SSH
- ✅ Wykonywanie komend
- ✅ Text2SSH end-to-end
- ✅ Test połączenia
- ✅ Multi-host scenarios
- ✅ LLM + SSH integration
- ✅ Error handling

## CI/CD Integration

### GitHub Actions

```yaml
name: SSH Integration Tests

on: [push, pull_request]

jobs:
  test-ssh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: corepack enable && pnpm install
      
      - name: Setup SSH test environment
        run: pnpm run ssh:setup
      
      - name: Run SSH integration tests
        run: pnpm run test:e2e:ssh
        env:
          VITE_OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
      
      - name: Cleanup
        if: always()
        run: pnpm run ssh:stop
```

## Roadmap

### Planowane Funkcje

- [ ] SSH tunneling (port forwarding)
- [ ] SCP/SFTP file transfer
- [ ] SSH config file parsing
- [ ] Multi-hop SSH (jump hosts)
- [ ] SSH agent forwarding
- [ ] Persistent SSH sessions
- [ ] Command history per host
- [ ] SSH key management UI
- [ ] Ansible playbook execution
- [ ] Docker container SSH

### Ulepszenia LLM

- [ ] Automatyczna diagnostyka problemów
- [ ] Sugestie optymalizacji
- [ ] Wykrywanie anomalii w logach
- [ ] Generowanie raportów
- [ ] Predykcja awarii

## Przykładowe Workflow

### Monitoring Serwera

```
1. "Sprawdź serwer 192.168.1.100"
   → LLM: "Sprawdzę status serwera..."
   → SSH: uptime, df -h, free -h, top
   → LLM: "Serwer działa 45 dni, dysk 70%, RAM 60%, CPU OK"

2. "Co zajmuje najwięcej miejsca?"
   → SSH: du -sh /* | sort -h
   → LLM: "Katalog /var/log zajmuje 15GB..."

3. "Wyczyść stare logi"
   → LLM: "Sugeruję: find /var/log -mtime +30 -delete"
   → User: "Wykonaj"
   → SSH: [wykonuje komendę]
```

### Diagnostyka Problemu

```
1. "Serwer nie odpowiada na port 80"
   → LLM: "Sprawdzę nginx..."
   → SSH: systemctl status nginx
   → LLM: "Nginx nie działa, sprawdzam logi..."
   → SSH: journalctl -u nginx -n 50
   → LLM: "Błąd konfiguracji w /etc/nginx/sites-enabled/default"

2. "Napraw to"
   → LLM: "Sugeruję: nginx -t && systemctl restart nginx"
   → User: "OK"
   → SSH: [wykonuje]
```

## Podsumowanie

Broxeen oferuje **pełną integrację SSH** z:

✅ **Wykonywaniem komend** - bezpośrednie i przez text2ssh  
✅ **Komendami głosowymi** - rozpoznawanie mowy → SSH  
✅ **Analizą LLM** - inteligentne odpowiedzi i sugestie  
✅ **Generowaniem komend** - LLM tworzy komendy SSH  
✅ **Testami Docker** - kompletne środowisko testowe  
✅ **E2E coverage** - testy jednostkowe + integracyjne  

System jest gotowy do użycia w produkcji i pokryty testami.
