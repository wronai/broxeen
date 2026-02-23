# SSH - Przykłady Użycia

## Szybki Start

### 1. Podstawowe Komendy

```bash
# Sprawdź uptime serwera
ssh 192.168.1.100 uptime

# Sprawdź użycie dysku
ssh 192.168.1.100 df -h

# Sprawdź pamięć RAM
ssh 192.168.1.100 free -h

# Sprawdź procesy
ssh 192.168.1.100 "ps aux | head -10"
```

### 2. Z Parametrami

```bash
# Inny użytkownik
ssh 192.168.1.100 user admin uptime

# Inny port
ssh 192.168.1.100 port 2222 uptime

# Kombinacja
ssh 192.168.1.100 user admin port 2222 df -h
```

## Text2SSH - Język Naturalny

### Polski

```bash
# Pamięć
text2ssh 192.168.1.100 ile pamięci
text2ssh 192.168.1.100 ile ram
text2ssh 192.168.1.100 sprawdź pamięć

# Dysk
text2ssh 192.168.1.100 sprawdź dysk
text2ssh 192.168.1.100 ile miejsca
text2ssh 192.168.1.100 użycie dysków

# Procesy
text2ssh 192.168.1.100 jakie procesy
text2ssh 192.168.1.100 obciążenie cpu
text2ssh 192.168.1.100 co działa

# System
text2ssh 192.168.1.100 jaki system
text2ssh 192.168.1.100 wersja systemu
text2ssh 192.168.1.100 informacje o systemie

# Użytkownicy
text2ssh 192.168.1.100 kto zalogowany
text2ssh 192.168.1.100 użytkownicy

# Sieć
text2ssh 192.168.1.100 interfejsy sieciowe
text2ssh 192.168.1.100 konfiguracja sieci
text2ssh 192.168.1.100 otwarte porty

# Usługi
text2ssh 192.168.1.100 jakie usługi
text2ssh 192.168.1.100 działające serwisy

# Logi
text2ssh 192.168.1.100 pokaż logi
text2ssh 192.168.1.100 ostatnie logi

# Docker
text2ssh 192.168.1.100 kontenery docker
text2ssh 192.168.1.100 docker containers

# Temperatura
text2ssh 192.168.1.100 temperatura
text2ssh 192.168.1.100 sensors
```

### Angielski

```bash
text2ssh 192.168.1.100 check memory
text2ssh 192.168.1.100 disk usage
text2ssh 192.168.1.100 what processes
text2ssh 192.168.1.100 system info
text2ssh 192.168.1.100 who is logged in
text2ssh 192.168.1.100 network interfaces
text2ssh 192.168.1.100 running services
text2ssh 192.168.1.100 show logs
```

## Komendy Głosowe

### Podstawowe

```
"Sprawdź dysk na serwerze 192.168.1.100"
"Ile pamięci ma serwer 192.168.1.100"
"Pokaż procesy na 192.168.1.100"
"Jaka temperatura na serwerze"
"Kto jest zalogowany na hoście"
```

### Z Kontekstem

```
"Połącz się z serwerem 192.168.1.100"
"Sprawdź uptime"
"Ile miejsca na dysku"
"Jakie usługi działają"
"Pokaż ostatnie logi"
```

### Diagnostyka

```
"Dlaczego serwer jest wolny"
"Co zajmuje najwięcej CPU"
"Sprawdź czy nginx działa"
"Pokaż błędy w logach"
"Jaki jest load average"
```

## Integracja z LLM

### Scenariusz 1: Monitoring

```
👤 User: "Sprawdź serwer 192.168.1.100"

🤖 Broxeen: [wykonuje: ssh 192.168.1.100 uptime && df -h && free -h]

📊 Wynik:
uptime: 45 days, 3:42
Filesystem      Size  Used Avail Use%
/dev/sda1       100G   70G   30G  70%
Mem:            16Gi  9.6Gi  6.4Gi

🧠 LLM: "Serwer działa 45 dni. Dysk wykorzystany w 70% (70GB/100GB). 
Pamięć RAM: 60% (9.6GB/16GB). System stabilny, brak problemów."

💡 Sugestie:
- "Sprawdź co zajmuje najwięcej miejsca"
- "Pokaż top 10 procesów"
- "Wyczyść stare logi"
```

### Scenariusz 2: Diagnostyka

```
👤 User: "Serwer nie odpowiada na port 80"

🧠 LLM: "Sprawdzę status nginx..."

🤖 Broxeen: [wykonuje: ssh host systemctl status nginx]

📊 Wynik: nginx.service - inactive (dead)

🧠 LLM: "Nginx nie działa. Sprawdzam logi..."

🤖 Broxeen: [wykonuje: ssh host journalctl -u nginx -n 50]

📊 Wynik: [Errno 98] Address already in use

🧠 LLM: "Problem: Port 80 jest zajęty przez inny proces. 
Sprawdzam co używa portu 80..."

🤖 Broxeen: [wykonuje: ssh host ss -tlnp | grep :80]

📊 Wynik: apache2 (pid 1234)

🧠 LLM: "Apache2 zajmuje port 80. Sugeruję:
1. Zatrzymać Apache: sudo systemctl stop apache2
2. Uruchomić Nginx: sudo systemctl start nginx
Lub zmienić port Nginx w konfiguracji."
```

### Scenariusz 3: Optymalizacja

```
👤 User: "Dysk się zapełnia, co zrobić?"

🧠 LLM: "Sprawdzę co zajmuje najwięcej miejsca..."

🤖 Broxeen: [wykonuje: ssh host du -sh /* | sort -h | tail -10]

📊 Wynik:
15G    /var/log
8G     /tmp
5G     /home/user/.cache

🧠 LLM: "Największe katalogi:
- /var/log: 15GB (logi systemowe)
- /tmp: 8GB (pliki tymczasowe)
- ~/.cache: 5GB (cache użytkownika)

Sugeruję:
1. Wyczyść stare logi (>30 dni)
2. Usuń pliki tymczasowe
3. Wyczyść cache

Czy wykonać automatyczne czyszczenie?"

👤 User: "Tak, wyczyść logi"

🤖 Broxeen: [wykonuje: ssh host find /var/log -name "*.log" -mtime +30 -delete]

🧠 LLM: "✅ Usunięto stare logi. Zwolniono ~12GB."
```

## Zaawansowane Przykłady

### Multi-Host Monitoring

```bash
# Sprawdź wiele serwerów
ssh 192.168.1.100 uptime
ssh 192.168.1.101 uptime
ssh 192.168.1.102 uptime

# LLM porównuje wyniki
"Serwer .100: 45 dni, load 0.5
 Serwer .101: 12 dni, load 2.3 ⚠️
 Serwer .102: 89 dni, load 0.1
 
 Uwaga: Serwer .101 ma wysokie obciążenie!"
```

### Automatyczna Diagnostyka

```
👤 User: "Sprawdź wszystkie serwery"

🧠 LLM: [generuje plan diagnostyczny]

🤖 Broxeen: [wykonuje sekwencję komend]
- ssh .100 uptime && df -h && free -h
- ssh .101 uptime && df -h && free -h
- ssh .102 uptime && df -h && free -h

🧠 LLM: [analizuje wyniki]

📊 Raport:
✅ Serwer .100: OK (uptime 45d, disk 70%, ram 60%)
⚠️  Serwer .101: Wysokie CPU (load 2.3)
⚠️  Serwer .102: Dysk 95% ❗

💡 Akcje:
1. Serwer .101: Sprawdź procesy (top)
2. Serwer .102: Wyczyść dysk (PILNE)
```

### Deployment Workflow

```
👤 User: "Wdróż nową wersję aplikacji"

🧠 LLM: "Rozpoczynam deployment..."

🤖 Broxeen:
1. ssh host "cd /app && git pull"
2. ssh host "docker-compose build"
3. ssh host "docker-compose up -d"
4. ssh host "docker ps"

🧠 LLM: "✅ Deployment zakończony. 
Kontenery działają:
- app_web_1 (up 5s)
- app_db_1 (up 10s)
- app_redis_1 (up 8s)

Sprawdzam logi..."

🤖 Broxeen: ssh host "docker logs app_web_1 --tail 20"

🧠 LLM: "✅ Aplikacja uruchomiona poprawnie. 
Brak błędów w logach."
```

## Testy Docker

### Setup Środowiska

```bash
# Uruchom serwery testowe
pnpm run ssh:setup

# Sprawdź status
docker ps | grep broxeen-ssh

# Logi
pnpm run ssh:logs
```

### Testowanie

```bash
# Ręczne połączenie
ssh -i docker/ssh-test/id_rsa -p 2222 testuser@localhost

# Test komend
ssh -i docker/ssh-test/id_rsa -p 2222 testuser@localhost uptime
ssh -i docker/ssh-test/id_rsa -p 2222 testuser@localhost df -h
ssh -i docker/ssh-test/id_rsa -p 2222 testuser@localhost free -h

# W aplikacji Broxeen
ssh localhost port 2222 user testuser uptime
text2ssh localhost port 2222 ile pamięci
test ssh localhost port 2222 user testuser
```

### E2E Tests

```bash
# Wszystkie testy SSH
pnpm run test:e2e:ssh

# Tylko integracyjne
pnpm run test:e2e e2e/ssh-integration.spec.ts

# Tylko Docker
pnpm run test:e2e e2e/ssh-docker.spec.ts

# UI mode
pnpm run test:e2e:ui
```

## Tips & Tricks

### 1. Aliasy Hostów

Zamiast IP, użyj nazw:

```bash
# ~/.ssh/config
Host prod-web
    HostName 192.168.1.100
    User admin
    Port 2222

Host prod-db
    HostName 192.168.1.101
    User postgres
```

W Broxeen:
```bash
ssh prod-web uptime
ssh prod-db "psql -c 'SELECT version()'"
```

### 2. Skrypty Diagnostyczne

Utwórz skrypt na serwerze:

```bash
# /usr/local/bin/health-check.sh
#!/bin/bash
echo "=== System Health ==="
uptime
df -h | grep -v tmpfs
free -h
top -bn1 | head -20
```

W Broxeen:
```bash
ssh host /usr/local/bin/health-check.sh
```

### 3. Monitoring w Pętli

```bash
# Co 5 sekund sprawdź load
watch -n 5 "ssh host uptime"

# W Broxeen (przez LLM)
"Monitoruj serwer co 5 sekund"
```

### 4. Batch Operations

```bash
# Sprawdź wszystkie serwery z pliku
for host in $(cat servers.txt); do
  ssh $host uptime
done

# W Broxeen (przez LLM)
"Sprawdź uptime na wszystkich serwerach"
```

## Rozwiązywanie Problemów

### Problem: "Tauri required"

```bash
# Uruchom aplikację Tauri
pnpm tauri dev

# Lub zbuduj
pnpm build
pnpm tauri build
```

### Problem: Permission denied

```bash
# Dodaj klucz SSH
ssh-copy-id -i ~/.ssh/id_rsa.pub user@host

# Lub w Broxeen
"Dodaj mój klucz SSH na serwer 192.168.1.100"
```

### Problem: Connection timeout

```bash
# Sprawdź sieć
ping host

# Sprawdź port
nc -zv host 22

# W Broxeen
test ssh host
```

### Problem: Command not found

```bash
# Sprawdź PATH na serwerze
ssh host "echo \$PATH"

# Użyj pełnej ścieżki
ssh host /usr/bin/df -h
```

## Podsumowanie

SSH w Broxeen obsługuje:

✅ **Bezpośrednie komendy** - `ssh host command`  
✅ **Text2SSH** - język naturalny → komenda  
✅ **Komendy głosowe** - rozpoznawanie mowy  
✅ **Analiza LLM** - inteligentne odpowiedzi  
✅ **Generowanie komend** - LLM tworzy komendy  
✅ **Multi-host** - wiele serwerów jednocześnie  
✅ **Diagnostyka** - automatyczne wykrywanie problemów  
✅ **Testy Docker** - kompletne środowisko testowe  

Wszystkie przykłady są gotowe do użycia!
