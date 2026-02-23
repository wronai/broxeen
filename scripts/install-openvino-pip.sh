#!/usr/bin/env bash
# ============================================================
# install-openvino-pip.sh
# Universal pip-based OpenVINO install.
# Works on any Linux/macOS with Python 3.9-3.12.
# Use this when native packages not available:
#   - Arch Linux, Alpine, exotic distros
#   - ARM (RPi, Jetson)
#   - Docker containers
#   - Virtual environments
# ============================================================
set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${CYAN}[openvino-pip]${NC} $*"; }
ok()   { echo -e "${GREEN}[openvino-pip]${NC} ✓ $*"; }
warn() { echo -e "${YELLOW}[openvino-pip]${NC} ⚠ $*"; }
err()  { echo -e "${RED}[openvino-pip]${NC} ✗ $*"; exit 1; }

OPENVINO_VERSION="${OPENVINO_VERSION:-2024.4}"
VENV_DIR="${OPENVINO_VENV_DIR:-/opt/openvino-env}"
SYSTEM_INSTALL="${OPENVINO_SYSTEM_INSTALL:-false}"  # true = no venv

# ── Find best Python ──────────────────────────────────────────────────────────
find_python() {
    local py=""
    for candidate in python3.12 python3.11 python3.10 python3.9 python3; do
        if command -v "$candidate" &>/dev/null; then
            local ver
            ver=$($candidate -c "import sys; print(sys.version_info[:2])" 2>/dev/null || echo "(0, 0)")
            # Must be >= 3.9
            if $candidate -c "import sys; exit(0 if sys.version_info >= (3,9) else 1)" 2>/dev/null; then
                py="$candidate"
                break
            fi
        fi
    done
    [ -n "$py" ] || err "Python >= 3.9 not found. Install it first."
    echo "$py"
}

# ── Install via venv (recommended) ───────────────────────────────────────────
install_in_venv() {
    local py="$1"

    log "Creating virtual environment: $VENV_DIR"
    sudo mkdir -p "$(dirname "$VENV_DIR")" 2>/dev/null || mkdir -p "$(dirname "$VENV_DIR")"
    $py -m venv "$VENV_DIR" --system-site-packages 2>/dev/null || $py -m venv "$VENV_DIR"

    log "Activating venv and installing OpenVINO ${OPENVINO_VERSION}..."
    # shellcheck source=/dev/null
    source "$VENV_DIR/bin/activate"

    pip install -q --upgrade pip setuptools wheel
    pip install -q "openvino==${OPENVINO_VERSION}" 2>/dev/null || \
        pip install -q openvino

    ok "OpenVINO installed in $VENV_DIR"

    # Create activation helper script
    local activate_script="/usr/local/bin/activate-openvino"
    sudo tee "$activate_script" > /dev/null << EOF
#!/bin/bash
source "$VENV_DIR/bin/activate"
echo "OpenVINO venv activated: \$(python -c 'import openvino; print(openvino.__version__)' 2>/dev/null)"
EOF
    sudo chmod +x "$activate_script" 2>/dev/null || chmod +x "$activate_script" 2>/dev/null || true

    # Append activation to .bashrc
    local marker="# OpenVINO venv"
    grep -q "$marker" ~/.bashrc 2>/dev/null || cat >> ~/.bashrc << BASH

$marker (added by broxeen-vision install)
source "$VENV_DIR/bin/activate"
BASH

    ok "Auto-activation added to ~/.bashrc"
    ok "Activate now: source $VENV_DIR/bin/activate"
}

# ── System-wide install (no venv) ─────────────────────────────────────────────
install_system_wide() {
    local py="$1"
    log "Installing OpenVINO system-wide (no venv)..."
    $py -m pip install -q --upgrade pip
    $py -m pip install -q --break-system-packages "openvino==${OPENVINO_VERSION}" 2>/dev/null || \
        $py -m pip install -q "openvino==${OPENVINO_VERSION}"
    ok "OpenVINO installed system-wide"
}

# ── Optional: OpenVINO dev tools (model optimizer, benchmark) ─────────────────
install_dev_tools() {
    log "Installing OpenVINO dev tools (optional)..."
    pip install -q openvino-dev 2>/dev/null || warn "openvino-dev install failed (non-critical)"
    pip install -q onnx onnxsim 2>/dev/null || true
    ok "Dev tools installed"
}

# ── Verify ────────────────────────────────────────────────────────────────────
verify_install() {
    log "Verifying..."
    python3 - << 'PYEOF' || warn "OpenVINO loaded but device check incomplete"
import openvino as ov
print(f"  OpenVINO version: {ov.__version__}")
core = ov.Core()
devices = core.available_devices
print(f"  Available devices: {devices}")
for d in devices:
    try:
        name = core.get_property(d, "FULL_DEVICE_NAME")
        print(f"    → {d}: {name}")
    except Exception:
        print(f"    → {d}")
PYEOF
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    echo -e "${BOLD}OpenVINO Universal pip Installer${NC}"
    echo ""

    local py
    py=$(find_python)
    log "Using: $py ($(${py} --version))"

    if [[ "$SYSTEM_INSTALL" == "true" ]]; then
        install_system_wide "$py"
    else
        install_in_venv "$py"
    fi

    install_dev_tools
    verify_install

    echo ""
    ok "Installation complete."
    echo -e "  Activate: ${CYAN}source $VENV_DIR/bin/activate${NC}"
    echo -e "  Or start new terminal (auto-activated via ~/.bashrc)"
}

main "$@"
