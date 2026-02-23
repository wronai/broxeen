#!/usr/bin/env bash
# ============================================================
# install-openvino-macos.sh
# Installs Intel OpenVINO on macOS (Intel + Apple Silicon)
#
# NOTE: OpenVINO on Apple Silicon uses CPU EP only.
#       For best performance on M1/M2/M3, consider using
#       CoreML EP via ort instead.
# ============================================================
set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${CYAN}[openvino]${NC} $*"; }
ok()   { echo -e "${GREEN}[openvino]${NC} ✓ $*"; }
warn() { echo -e "${YELLOW}[openvino]${NC} ⚠ $*"; }
err()  { echo -e "${RED}[openvino]${NC} ✗ $*"; exit 1; }

OPENVINO_VERSION="${OPENVINO_VERSION:-2024.4}"

# Detect Apple Silicon
IS_APPLE_SILICON=false
if [[ "$(uname -m)" == "arm64" ]]; then
    IS_APPLE_SILICON=true
    warn "Apple Silicon detected — OpenVINO uses CPU EP only (no GPU/NPU)"
    warn "For maximum performance consider: ort CoreML EP or MPS backend"
fi

install_homebrew_deps() {
    log "Installing Homebrew prerequisites..."
    if ! command -v brew &>/dev/null; then
        warn "Homebrew not found — installing..."
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi

    brew install cmake python@3.11 pkg-config || true
    ok "Homebrew dependencies installed"
}

install_via_pip() {
    log "Installing OpenVINO via pip..."

    # Use Python 3.11 (best compatibility with OpenVINO on macOS)
    local py="python3"
    if command -v python3.11 &>/dev/null; then py="python3.11"; fi

    $py -m pip install -q --upgrade pip
    $py -m pip install -q "openvino==${OPENVINO_VERSION}" || \
        $py -m pip install -q openvino

    ok "OpenVINO installed via pip"
}

install_via_brew() {
    log "Installing OpenVINO via Homebrew (if available)..."
    brew install openvino 2>/dev/null && ok "OpenVINO via brew" && return 0
    warn "OpenVINO formula not in brew — using pip"
    return 1
}

print_macos_notes() {
    echo ""
    echo -e "${YELLOW}${BOLD}macOS Notes:${NC}"
    if $IS_APPLE_SILICON; then
        echo "  • Apple Silicon: OpenVINO CPU EP only (ARM optimized)"
        echo "  • For ONNX models, also consider: ort CoreML EP"
        echo "  • Install CoreML-capable ort: pip install ort-coreml (if available)"
    else
        echo "  • Intel Mac: OpenVINO CPU EP with AVX2 optimization"
    fi
    echo "  • OpenVINO GPU EP requires Intel GPU — not available on Mac"
    echo "  • Broxeen Vision config: set use_openvino=false, intra_threads=4"
    echo ""
}

setup_environment() {
    # Find and add setupvars to shell profile
    local setupvars
    setupvars=$(find /usr/local/lib/python*/site-packages/openvino -name "*.sh" 2>/dev/null | head -1 || \
                find ~/Library/Python -name "setupvars.sh" 2>/dev/null | head -1 || echo "")

    local profile="$HOME/.zshrc"
    [ -f "$HOME/.bash_profile" ] && profile="$HOME/.bash_profile"

    if [ -n "$setupvars" ]; then
        grep -q "OpenVINO" "$profile" 2>/dev/null || echo "source $setupvars" >> "$profile"
    fi

    # Export for current session
    python3 -c "import openvino; print('OpenVINO', openvino.__version__)" 2>/dev/null || true
}

verify_install() {
    python3 - << 'PYEOF' 2>/dev/null || warn "Verify manually after restart"
import openvino as ov
print(f"OpenVINO version: {ov.__version__}")
core = ov.Core()
print(f"Available devices: {core.available_devices}")
PYEOF
}

main() {
    echo -e "${BOLD}Intel OpenVINO — macOS Installer (v${OPENVINO_VERSION})${NC}"
    echo ""
    install_homebrew_deps
    install_via_brew || install_via_pip
    setup_environment
    verify_install
    print_macos_notes
    ok "Done."
}

main "$@"
