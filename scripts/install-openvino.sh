#!/usr/bin/env bash
# ============================================================
# install-openvino.sh — Master auto-installer
#
# Detects platform, then calls the right sub-installer.
# Works on: Ubuntu 20/22/24, Debian, Fedora, RHEL, macOS,
#            Arch, Raspberry Pi, any Linux with Python 3.9+
#
# Usage:
#   ./scripts/install-openvino.sh           # auto-detect
#   ./scripts/install-openvino.sh --pip     # force pip
#   ./scripts/install-openvino.sh --docker  # use Docker
#   ./scripts/install-openvino.sh --check   # check only
# ============================================================
set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${CYAN}[install]${NC} $*"; }
ok()   { echo -e "${GREEN}[install]${NC} ✓ $*"; }
warn() { echo -e "${YELLOW}[install]${NC} ⚠ $*"; }
err()  { echo -e "${RED}[install]${NC} ✗ $*"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Parse args ────────────────────────────────────────────────────────────────
FORCE_METHOD="${OPENVINO_FORCE_METHOD:-auto}"
for arg in "$@"; do
    case "$arg" in
        --pip)    FORCE_METHOD="pip" ;;
        --docker) FORCE_METHOD="docker" ;;
        --apt)    FORCE_METHOD="apt" ;;
        --yum)    FORCE_METHOD="yum" ;;
        --brew)   FORCE_METHOD="brew" ;;
        --check)  FORCE_METHOD="check" ;;
        --help|-h)
            echo "Usage: $0 [--pip|--docker|--apt|--yum|--brew|--check]"
            echo "  --pip     Force pip install (universal)"
            echo "  --docker  Use Docker-based install"
            echo "  --apt     Force apt (Ubuntu/Debian)"
            echo "  --yum     Force dnf/yum (RHEL/Fedora)"
            echo "  --brew    Force Homebrew (macOS)"
            echo "  --check   Check current installation"
            exit 0
            ;;
    esac
done

# ── Run platform detection ────────────────────────────────────────────────────
run_detect() {
    if [ -f "$SCRIPT_DIR/detect-platform.sh" ]; then
        bash "$SCRIPT_DIR/detect-platform.sh" --export "$SCRIPT_DIR/../.platform-detection"
        # shellcheck source=/dev/null
        source "$SCRIPT_DIR/../.platform-detection"
    else
        warn "detect-platform.sh not found — using basic detection"
        PLATFORM_OS="linux"
        PLATFORM_CPU_VENDOR="unknown"
        OPENVINO_INSTALL_METHOD="pip"
    fi
}

# ── Check existing installation ───────────────────────────────────────────────
check_install() {
    echo ""
    echo -e "${BOLD}Checking OpenVINO installation...${NC}"
    echo ""

    local found=false

    # Check Python package
    if python3 -c "import openvino; print('  Python package:', openvino.__version__)" 2>/dev/null; then
        found=true
        # Check available devices
        python3 - << 'PYEOF' 2>/dev/null || true
import openvino as ov
core = ov.Core()
devices = core.available_devices
print(f"  Available devices: {devices}")
for d in devices:
    try:
        name = core.get_property(d, "FULL_DEVICE_NAME")
        print(f"    {d}: {name}")
    except Exception:
        print(f"    {d}: (property read failed)")
PYEOF
    fi

    # Check system package
    if command -v dpkg &>/dev/null && dpkg -l openvino 2>/dev/null | grep -q "^ii"; then
        echo "  apt package: installed"
        found=true
    fi

    # Check pip in venvs
    for venv in /opt/openvino-env /opt/openvino-venv ~/.local/openvino-env; do
        if [ -f "$venv/bin/activate" ]; then
            echo "  venv found: $venv"
            found=true
        fi
    done

    # Check setupvars
    for path in /opt/intel/openvino_2024/setupvars.sh /opt/intel/openvino/setupvars.sh; do
        if [ -f "$path" ]; then
            echo "  setupvars: $path"
            found=true
        fi
    done

    if $found; then
        ok "OpenVINO is installed"
    else
        warn "OpenVINO NOT found"
        echo "  Run: make install-openvino   to install"
    fi
    echo ""
    return 0
}

# ── Main dispatch ─────────────────────────────────────────────────────────────
main() {
    echo ""
    echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}║   Broxeen Vision — OpenVINO Auto-Installer              ║${NC}"
    echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""

    if [[ "$FORCE_METHOD" == "check" ]]; then
        check_install
        return 0
    fi

    # Run platform detection
    run_detect

    # Print detected platform
    echo -e "  Platform:  ${PLATFORM_OS:-unknown} / ${PLATFORM_ARCH:-unknown}"
    echo -e "  CPU:       ${PLATFORM_CPU_VENDOR:-unknown} ${INTEL_CPU_GEN:+[$INTEL_CPU_GEN]}"
    echo -e "  GPU:       ${PLATFORM_GPU:-unknown}"
    echo -e "  Rec. EP:   ${OPENVINO_EP:-CPU}"
    echo ""

    # Resolve install method
    local method="${FORCE_METHOD}"
    if [[ "$method" == "auto" ]]; then
        method="${OPENVINO_INSTALL_METHOD:-pip}"
    fi

    log "Install method: $method"
    echo ""

    case "$method" in
        apt|ubuntu|debian)
            bash "$SCRIPT_DIR/install-openvino-ubuntu.sh"
            ;;
        yum|dnf|rhel|fedora)
            bash "$SCRIPT_DIR/install-openvino-rhel.sh"
            ;;
        brew|macos)
            bash "$SCRIPT_DIR/install-openvino-macos.sh"
            ;;
        docker)
            bash "$SCRIPT_DIR/install-openvino-docker.sh" all
            ;;
        pip|*)
            bash "$SCRIPT_DIR/install-openvino-pip.sh"
            ;;
    esac

    echo ""
    echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}${BOLD}║   OpenVINO installed!                                   ║${NC}"
    echo -e "${GREEN}${BOLD}╠══════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}  Recommended OpenVINO EP for your hardware: ${BOLD}${OPENVINO_EP:-CPU}${NC}"
    echo -e "${GREEN}  Set in broxeen.toml:${NC}"
    echo -e "    use_openvino = $([ "${OPENVINO_EP:-CPU}" != "CPU" ] && echo 'true' || echo 'false')"
    echo -e ""
    echo -e "  Next steps:"
    echo -e "  ${CYAN}make setup-model${NC}      ← download YOLOv8s ONNX"
    echo -e "  ${CYAN}make build-n5105${NC}      ← compile (or make build-dev)"
    echo -e "  ${CYAN}make run${NC}              ← start pipeline"
    echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

main "$@"
