#!/bin/bash
# setup-audio.sh — Install audio dependencies for Broxeen
# Run: chmod +x setup-audio.sh && ./setup-audio.sh

set -e

echo "🔊 Broxeen Audio Setup"
echo "======================"
echo ""

# ── Colors ────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
err()  { echo -e "${RED}✗${NC} $1"; }

# ── 1. System dependencies ───────────────────────────

echo "1/3 Instalacja zależności systemowych..."

if command -v apt &>/dev/null; then
    sudo apt update -qq
    sudo apt install -y libasound2-dev espeak-ng
    ok "libasound2-dev + espeak-ng zainstalowane"
elif command -v dnf &>/dev/null; then
    sudo dnf install -y alsa-lib-devel espeak-ng
    ok "alsa-lib-devel + espeak-ng zainstalowane"
elif command -v pacman &>/dev/null; then
    sudo pacman -S --noconfirm alsa-lib espeak-ng
    ok "alsa-lib + espeak-ng zainstalowane"
else
    warn "Nieznany menedżer pakietów. Zainstaluj ręcznie: libasound2-dev, espeak-ng"
fi

# ── 2. Piper TTS (neural, lepszy głos) ──────────────

PIPER_DIR="$HOME/.local/share/broxeen/piper"
PIPER_BIN="$PIPER_DIR/piper"
PIPER_MODEL="$PIPER_DIR/pl_PL-darkman-medium.onnx"

echo ""
echo "2/3 Piper TTS (neural text-to-speech)..."

mkdir -p "$PIPER_DIR"

# Download Piper binary
if [ -f "$PIPER_BIN" ]; then
    ok "Piper binary już istnieje: $PIPER_BIN"
else
    echo "   Pobieram Piper binary (~30MB)..."
    ARCH=$(uname -m)
    if [ "$ARCH" = "x86_64" ]; then
        PIPER_URL="https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz"
    elif [ "$ARCH" = "aarch64" ]; then
        PIPER_URL="https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_aarch64.tar.gz"
    else
        err "Nieobsługiwana architektura: $ARCH"
        exit 1
    fi

    wget -q --show-progress -O /tmp/piper.tar.gz "$PIPER_URL"
    tar xzf /tmp/piper.tar.gz -C "$PIPER_DIR" --strip-components=1
    chmod +x "$PIPER_BIN"
    rm /tmp/piper.tar.gz
    ok "Piper binary: $PIPER_BIN"
fi

# Download Polish voice model
if [ -f "$PIPER_MODEL" ]; then
    ok "Polski model Piper już istnieje"
else
    echo "   Pobieram polski głos (darkman-medium, ~45MB)..."

    HF_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/pl/pl_PL/darkman/medium"

    wget -q --show-progress -O "$PIPER_MODEL" \
        "$HF_BASE/pl_PL-darkman-medium.onnx"
    wget -q --show-progress -O "$PIPER_MODEL.json" \
        "$HF_BASE/pl_PL-darkman-medium.onnx.json"

    ok "Polski model Piper: $PIPER_MODEL"
fi

# ── 3. Verify ────────────────────────────────────────

echo ""
echo "3/3 Weryfikacja..."

# Test espeak-ng
if command -v espeak-ng &>/dev/null; then
    ok "espeak-ng: $(espeak-ng --version 2>&1 | head -1)"
else
    warn "espeak-ng nie znaleziony"
fi

# Test Piper
if [ -f "$PIPER_BIN" ] && [ -f "$PIPER_MODEL" ]; then
    echo "   Testowanie Piper..."
    TEST_RESULT=$(echo "Test głosu" | "$PIPER_BIN" --model "$PIPER_MODEL" --output-raw 2>/dev/null | wc -c)
    if [ "$TEST_RESULT" -gt 1000 ]; then
        ok "Piper działa! (wygenerowano ${TEST_RESULT} bajtów audio)"
    else
        warn "Piper zainstalowany ale test nie wygenerował audio"
    fi
else
    warn "Piper nie w pełni zainstalowany"
fi

# Test ALSA
if [ -f /usr/include/alsa/asoundlib.h ] || [ -f /usr/include/alsa/pcm.h ]; then
    ok "ALSA development headers zainstalowane"
else
    warn "Brak ALSA headers — kompilacja cpal może się nie powieść"
fi

echo ""
echo "════════════════════════════════════════"
echo -e "${GREEN}Setup zakończony!${NC}"
echo ""
echo "Teraz możesz:"
echo "  make dev          # lub: npm run tauri dev"
echo ""
echo "Zmienne środowiskowe (opcjonalne, w .env):"
echo "  PIPER_BINARY=$PIPER_BIN"
echo "  PIPER_MODEL=$PIPER_MODEL"
echo "════════════════════════════════════════"
