#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# Broxeen CLI Integration Test Script
# Compares real system/network output with what Broxeen should report.
# Usage: bash scripts/test-broxeen-cli.sh [--verbose]
# ──────────────────────────────────────────────────────────────

set -euo pipefail

VERBOSE="${1:-}"
PASS=0
FAIL=0
SKIP=0
RESULTS=()

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${BLUE}[TEST]${NC} $*"; }
pass() { PASS=$((PASS+1)); RESULTS+=("${GREEN}✅ PASS${NC}: $1"); echo -e "${GREEN}✅ PASS${NC}: $1"; }
fail() { FAIL=$((FAIL+1)); RESULTS+=("${RED}❌ FAIL${NC}: $1 — $2"); echo -e "${RED}❌ FAIL${NC}: $1 — $2"; }
skip() { SKIP=$((SKIP+1)); RESULTS+=("${YELLOW}⏭️  SKIP${NC}: $1 — $2"); echo -e "${YELLOW}⏭️  SKIP${NC}: $1 — $2"; }
info() { [[ "$VERBOSE" == "--verbose" ]] && echo -e "     $*" || true; }

# ──────────────────────────────────────────────────────────────
# 1. DISK INFO — compare df output
# ──────────────────────────────────────────────────────────────

log "=== DISK INFO TESTS ==="

# Test: df command available
if command -v df &>/dev/null; then
  pass "df command available"
else
  fail "df command available" "df not found in PATH"
fi

# Test: Root filesystem exists and has data
ROOT_TOTAL=$(df -B1 / 2>/dev/null | tail -1 | awk '{print $2}')
ROOT_USED=$(df -B1 / 2>/dev/null | tail -1 | awk '{print $3}')
ROOT_AVAIL=$(df -B1 / 2>/dev/null | tail -1 | awk '{print $4}')
ROOT_PCT=$(df / 2>/dev/null | tail -1 | awk '{print $5}' | tr -d '%')

if [[ -n "$ROOT_TOTAL" && "$ROOT_TOTAL" -gt 0 ]]; then
  pass "Root filesystem detected (total=${ROOT_TOTAL} bytes)"
  info "  Used: ${ROOT_USED}, Available: ${ROOT_AVAIL}, Usage: ${ROOT_PCT}%"
else
  fail "Root filesystem detected" "Could not read df output"
fi

# Test: Multiple partitions detectable
PART_COUNT=$(df -B1 -x tmpfs -x devtmpfs -x squashfs 2>/dev/null | grep '^/dev/' | wc -l)
if [[ "$PART_COUNT" -gt 0 ]]; then
  pass "Real partitions found: ${PART_COUNT}"
  if [[ "$VERBOSE" == "--verbose" ]]; then
    df -h -x tmpfs -x devtmpfs -x squashfs 2>/dev/null | grep '^/dev/'
  fi
else
  fail "Real partitions found" "No /dev/* partitions in df output"
fi

# Test: hostname command
HOSTNAME_OUT=$(hostname 2>/dev/null || echo "")
if [[ -n "$HOSTNAME_OUT" ]]; then
  pass "Hostname detected: ${HOSTNAME_OUT}"
else
  fail "Hostname detected" "hostname command returned empty"
fi

echo ""

# ──────────────────────────────────────────────────────────────
# 2. SSH TESTS — check SSH tooling and connectivity
# ──────────────────────────────────────────────────────────────

log "=== SSH TESTS ==="

# Test: ssh binary available
if command -v ssh &>/dev/null; then
  SSH_VERSION=$(ssh -V 2>&1 || true)
  pass "SSH client available: ${SSH_VERSION}"
else
  fail "SSH client available" "ssh not found in PATH"
fi

# Test: known_hosts file exists
KNOWN_HOSTS="$HOME/.ssh/known_hosts"
if [[ -f "$KNOWN_HOSTS" ]]; then
  KH_COUNT=$(grep -cv '^#\|^$' "$KNOWN_HOSTS" 2>/dev/null || echo 0)
  pass "known_hosts exists with ${KH_COUNT} entries"
  if [[ "$VERBOSE" == "--verbose" && "$KH_COUNT" -gt 0 ]]; then
    head -5 "$KNOWN_HOSTS" | awk '{print "  " $1 " " $2}'
  fi
else
  skip "known_hosts" "File not found at $KNOWN_HOSTS"
fi

# Test: SSH localhost connectivity
if ss -tlnp 2>/dev/null | grep -q ':22 ' || netstat -tlnp 2>/dev/null | grep -q ':22 '; then
  pass "SSH server running on port 22"

  # Try SSH banner grab
  SSH_BANNER=$(timeout 3 bash -c 'echo "" | nc -w2 127.0.0.1 22 2>/dev/null | head -1' || echo "")
  if [[ "$SSH_BANNER" == SSH-* ]]; then
    pass "SSH banner from localhost: ${SSH_BANNER}"
  else
    skip "SSH banner from localhost" "Could not grab banner (nc/timeout issue)"
  fi
else
  skip "SSH server running on port 22" "No local SSH server detected"
fi

echo ""

# ──────────────────────────────────────────────────────────────
# 3. NETWORK DISCOVERY — compare real network with broxeen scan
# ──────────────────────────────────────────────────────────────

log "=== NETWORK DISCOVERY TESTS ==="

# Detect local subnet
LOCAL_IP=$(ip route get 8.8.8.8 2>/dev/null | grep -oP 'src \K[\d.]+' || hostname -I 2>/dev/null | awk '{print $1}' || echo "")
if [[ -n "$LOCAL_IP" ]]; then
  SUBNET=$(echo "$LOCAL_IP" | awk -F. '{print $1"."$2"."$3}')
  pass "Local IP detected: ${LOCAL_IP} (subnet: ${SUBNET}.0/24)"
else
  fail "Local IP detected" "Could not determine local IP"
  SUBNET="192.168.1"
fi

# Test: ARP cache
ARP_HOSTS=0
if command -v arp &>/dev/null; then
  ARP_HOSTS=$(arp -a 2>/dev/null | grep -cv 'incomplete\|^$' || echo 0)
  if [[ "$ARP_HOSTS" -gt 0 ]]; then
    pass "ARP cache has ${ARP_HOSTS} entries"
    if [[ "$VERBOSE" == "--verbose" ]]; then
      arp -a 2>/dev/null | grep -v incomplete | head -10
    fi
  else
    skip "ARP cache" "Empty (no recent network activity)"
  fi
else
  skip "ARP cache" "arp command not available"
fi

# Test: arp-scan tool
if command -v arp-scan &>/dev/null; then
  # Try with sudo if available
  if sudo -n arp-scan --localnet --quiet 2>/dev/null | head -1 | grep -qP '\d+\.\d+'; then
    ARPSCAN_COUNT=$(sudo -n arp-scan --localnet --quiet 2>/dev/null | grep -cP '^\d' || echo 0)
    pass "arp-scan found ${ARPSCAN_COUNT} devices"
  else
    skip "arp-scan" "Requires sudo privileges"
  fi
else
  skip "arp-scan" "Not installed (install: sudo apt install arp-scan)"
fi

# Test: Quick TCP scan of common ports on gateway
GATEWAY=$(ip route show default 2>/dev/null | awk '{print $3}' | head -1 || echo "")
if [[ -n "$GATEWAY" ]]; then
  pass "Default gateway: ${GATEWAY}"

  # Check if gateway responds on common ports
  GW_PORTS_OPEN=0
  for port in 80 443 22 53; do
    if timeout 1 bash -c "echo >/dev/tcp/${GATEWAY}/${port}" 2>/dev/null; then
      GW_PORTS_OPEN=$((GW_PORTS_OPEN+1))
      info "  Gateway port ${port}: OPEN"
    fi
  done
  if [[ "$GW_PORTS_OPEN" -gt 0 ]]; then
    pass "Gateway has ${GW_PORTS_OPEN} open ports"
  else
    skip "Gateway open ports" "No common ports responded"
  fi
else
  skip "Default gateway" "Could not detect"
fi

# Test: Network interfaces
IF_COUNT=$(ip -4 addr show 2>/dev/null | grep -c 'inet ' || echo 0)
if [[ "$IF_COUNT" -gt 0 ]]; then
  pass "Network interfaces with IPv4: ${IF_COUNT}"
  if [[ "$VERBOSE" == "--verbose" ]]; then
    ip -4 addr show 2>/dev/null | grep 'inet ' | awk '{print "  " $NF ": " $2}'
  fi
else
  fail "Network interfaces" "No IPv4 interfaces found"
fi

# Test: Quick subnet scan (first 10 IPs for speed)
log "Quick subnet scan (${SUBNET}.1-10)..."
FOUND_HOSTS=0
for i in $(seq 1 10); do
  IP="${SUBNET}.${i}"
  if timeout 0.5 bash -c "echo >/dev/tcp/${IP}/80" 2>/dev/null || \
     timeout 0.5 bash -c "echo >/dev/tcp/${IP}/22" 2>/dev/null || \
     timeout 0.5 bash -c "echo >/dev/tcp/${IP}/443" 2>/dev/null; then
    FOUND_HOSTS=$((FOUND_HOSTS+1))
    info "  ${IP}: reachable"
  fi
done
if [[ "$FOUND_HOSTS" -gt 0 ]]; then
  pass "Quick scan found ${FOUND_HOSTS} hosts in ${SUBNET}.1-10"
else
  skip "Quick subnet scan" "No hosts responded in ${SUBNET}.1-10"
fi

echo ""

# ──────────────────────────────────────────────────────────────
# 4. BROXEEN EXPECTED BEHAVIOR VALIDATION
# ──────────────────────────────────────────────────────────────

log "=== BROXEEN BEHAVIOR EXPECTATIONS ==="

# Check if Tauri app binary exists
TAURI_BIN=$(find . -path '*/release/broxeen' -o -path '*/debug/broxeen' 2>/dev/null | head -1)
if [[ -n "$TAURI_BIN" ]]; then
  pass "Broxeen binary found: ${TAURI_BIN}"
else
  skip "Broxeen binary" "Not built yet (run: cargo tauri build)"
fi

# Verify frontend dev server
if curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/ 2>/dev/null | grep -q '200'; then
  pass "Frontend dev server running on localhost:5173"
else
  skip "Frontend dev server" "Not running (start with: pnpm dev)"
fi

# Test: mDNS discovery tool
if command -v avahi-browse &>/dev/null; then
  MDNS_COUNT=$(timeout 3 avahi-browse -a -t --no-db-lookup 2>/dev/null | wc -l || echo 0)
  if [[ "$MDNS_COUNT" -gt 0 ]]; then
    pass "mDNS (avahi-browse) found ${MDNS_COUNT} service lines"
  else
    skip "mDNS discovery" "No services found (timeout)"
  fi
else
  skip "mDNS discovery" "avahi-browse not installed"
fi

echo ""

# ──────────────────────────────────────────────────────────────
# 5. COMPARISON SUMMARY
# ──────────────────────────────────────────────────────────────

log "=== COMPARISON SUMMARY ==="
echo ""
echo "System data that Broxeen should report:"
echo "  🖥️  Hostname:     ${HOSTNAME_OUT:-unknown}"
echo "  📡 Local IP:      ${LOCAL_IP:-unknown}"
echo "  🌐 Subnet:        ${SUBNET:-unknown}.0/24"
echo "  🚪 Gateway:       ${GATEWAY:-unknown}"
echo "  💾 Disk partitions: ${PART_COUNT:-0}"
echo "  📊 Root usage:    ${ROOT_PCT:-?}%"
echo "  🔑 SSH known hosts: ${KH_COUNT:-0}"
echo "  📡 ARP neighbors:  ${ARP_HOSTS:-0}"
echo "  🔍 Reachable hosts (quick): ${FOUND_HOSTS:-0}"
echo ""

echo "──────────────────────────────────────────"
echo -e "Results: ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}, ${YELLOW}${SKIP} skipped${NC}"
echo "──────────────────────────────────────────"
echo ""

if [[ "$VERBOSE" == "--verbose" ]]; then
  echo "Detailed results:"
  for r in "${RESULTS[@]}"; do
    echo -e "  $r"
  done
  echo ""
fi

if [[ "$FAIL" -gt 0 ]]; then
  echo -e "${RED}Some tests failed. Check system tools availability.${NC}"
  exit 1
else
  echo -e "${GREEN}All tests passed or skipped.${NC}"
  exit 0
fi
