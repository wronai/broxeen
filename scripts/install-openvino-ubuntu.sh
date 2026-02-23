#!/usr/bin/env bash
# ============================================================
# install-openvino-ubuntu.sh
# Installs Intel OpenVINO runtime on Ubuntu 20.04/22.04/24.04
# and Debian. Uses apt when possible, pip as fallback.
# ============================================================
set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${CYAN}[openvino]${NC} $*"; }
ok()   { echo -e "${GREEN}[openvino]${NC} ✓ $*"; }
warn() { echo -e "${YELLOW}[openvino]${NC} ⚠ $*"; }
err()  { echo -e "${RED}[openvino]${NC} ✗ $*"; exit 1; }

OPENVINO_VERSION="${OPENVINO_VERSION:-2024.4}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load platform detection if available
if [ -f "$SCRIPT_DIR/../.platform-detection" ]; then
    # shellcheck source=/dev/null
    source "$SCRIPT_DIR/../.platform-detection"
fi

# ── Detect Ubuntu version if not already set ─────────────────────────────────
if [ -z "${OPENVINO_APT_DIST:-}" ]; then
    if [ -f /etc/os-release ]; then
        # shellcheck source=/dev/null
        source /etc/os-release
        case "${VERSION_ID:-}" in
            22.04*) OPENVINO_APT_DIST="ubuntu22" ;;
            24.04*) OPENVINO_APT_DIST="ubuntu24" ;;
            20.04*) OPENVINO_APT_DIST="ubuntu20" ;;
            12*)    OPENVINO_APT_DIST="debian12"; INSTALL_METHOD="pip" ;;
            11*)    OPENVINO_APT_DIST="debian11"; INSTALL_METHOD="pip" ;;
            *)      OPENVINO_APT_DIST="ubuntu22"; INSTALL_METHOD="pip" ;;
        esac
    else
        OPENVINO_APT_DIST="ubuntu22"
    fi
fi

INSTALL_METHOD="${INSTALL_METHOD:-apt}"

# ── Step 1: System prerequisites ──────────────────────────────────────────────
install_prerequisites() {
    log "Installing system prerequisites..."
    sudo apt-get update -q
    sudo apt-get install -y -q \
        curl wget gnupg2 apt-transport-https ca-certificates \
        python3 python3-pip python3-dev \
        lsb-release software-properties-common \
        libgl1-mesa-glx libglib2.0-0 libgomp1
    ok "Prerequisites installed"
}

# ── Step 2a: apt install (Ubuntu 20/22/24) ────────────────────────────────────
install_via_apt() {
    log "Installing OpenVINO via Intel APT repository ($OPENVINO_APT_DIST)..."

    # Add Intel GPG key
    local key_url="https://apt.repos.intel.com/intel-gpg-keys/GPG-PUB-KEY-INTEL-SW-PRODUCTS.PUB"
    log "Adding Intel GPG key..."
    wget -qO - "$key_url" | sudo apt-key add - 2>/dev/null || \
        wget -qO - "$key_url" | gpg --dearmor | sudo tee /usr/share/keyrings/intel-openvino.gpg > /dev/null

    # Add repository
    local repo_url="https://apt.repos.intel.com/openvino/2024"
    echo "deb ${repo_url} ${OPENVINO_APT_DIST} main" | \
        sudo tee /etc/apt/sources.list.d/intel-openvino-2024.list

    sudo apt-get update -q

    # Install runtime
    log "Installing openvino-${OPENVINO_VERSION}..."
    if sudo apt-get install -y "openvino-${OPENVINO_VERSION}"; then
        ok "OpenVINO ${OPENVINO_VERSION} installed via apt"
        OPENVINO_INSTALL_ROOT="/opt/intel/openvino_${OPENVINO_VERSION}"
        return 0
    else
        warn "apt install failed, trying latest available version..."
        sudo apt-get install -y openvino || return 1
        OPENVINO_INSTALL_ROOT=$(ls -d /opt/intel/openvino_* 2>/dev/null | sort -V | tail -1 || echo "")
        ok "OpenVINO installed via apt (latest)"
        return 0
    fi
}

# ── Step 2b: pip install (fallback / Debian / custom) ─────────────────────────
install_via_pip() {
    log "Installing OpenVINO via pip (Python package)..."

    # Create dedicated venv for cleaner install
    local venv_dir="/opt/openvino-venv"
    if command -v python3 &>/dev/null; then
        python3 -m venv "$venv_dir" --system-site-packages 2>/dev/null || \
            python3 -m venv "$venv_dir"
        source "$venv_dir/bin/activate"
        pip install -q --upgrade pip
        pip install -q "openvino==${OPENVINO_VERSION}" || pip install -q openvino
        ok "OpenVINO installed via pip in $venv_dir"
        OPENVINO_INSTALL_ROOT="$venv_dir"
        echo "source $venv_dir/bin/activate" >> ~/.bashrc
    else
        err "python3 not found — cannot install via pip"
    fi
}

# ── Step 3: Intel GPU runtime (for GPU EP on iGPU/Arc) ────────────────────────
install_gpu_runtime() {
    log "Installing Intel GPU runtime (NEO compute stack)..."

    # Required for GPU EP: intel-opencl-icd + level-zero
    sudo apt-get install -y -q \
        intel-opencl-icd \
        intel-level-zero-gpu \
        level-zero \
        clinfo 2>/dev/null || true

    # Add user to render/video groups
    sudo usermod -aG render "$USER" 2>/dev/null || true
    sudo usermod -aG video  "$USER" 2>/dev/null || true

    if clinfo 2>/dev/null | grep -q "Intel"; then
        ok "Intel GPU runtime active (OpenCL available)"
    else
        warn "Intel GPU runtime installed but no device detected yet"
        warn "Log out and back in, then retry: clinfo | grep Intel"
    fi
}

# ── Step 4: OpenVINO Python bindings (for model conversion) ───────────────────
install_python_extras() {
    log "Installing OpenVINO Python extras (model optimizer, tools)..."
    pip3 install -q --upgrade pip 2>/dev/null || true
    pip3 install -q \
        openvino-dev \
        openvino-telemetry \
        onnx \
        ultralytics 2>/dev/null || warn "Some Python extras failed (non-critical)"
    ok "Python extras installed"
}

# ── Step 5: Environment setup ──────────────────────────────────────────────────
setup_environment() {
    log "Setting up environment..."

    # Find setupvars.sh
    local setupvars=""
    for path in \
        /opt/intel/openvino_${OPENVINO_VERSION}/setupvars.sh \
        /opt/intel/openvino_2024/setupvars.sh \
        /opt/intel/openvino/setupvars.sh \
        $(ls -d /opt/intel/openvino_* 2>/dev/null | sort -V | tail -1)/setupvars.sh; do
        if [ -f "$path" ]; then
            setupvars="$path"
            break
        fi
    done

    if [ -n "$setupvars" ]; then
        # Add to .bashrc and .profile
        local marker="# Intel OpenVINO"
        if ! grep -q "$marker" ~/.bashrc 2>/dev/null; then
            cat >> ~/.bashrc << EOF

$marker (added by broxeen-vision install)
source "$setupvars"
export OPENVINO_INSTALL_DIR="$(dirname "$setupvars")"
EOF
        fi
        ok "Environment: source $setupvars added to ~/.bashrc"

        # Create system-wide activation helper
        cat > /tmp/activate-openvino.sh << EOF
#!/bin/bash
# Source this to activate OpenVINO in current shell:
#   source /tmp/activate-openvino.sh
source "$setupvars"
echo "OpenVINO activated: \$(python3 -c 'import openvino; print(openvino.__version__)' 2>/dev/null || echo 'check manually')"
EOF
        chmod +x /tmp/activate-openvino.sh

        ok "Run:  source $setupvars"
        ok "Or:   source /tmp/activate-openvino.sh"
    else
        warn "setupvars.sh not found — OpenVINO may be pip-only"
        warn "Run: python3 -c \"import openvino; print(openvino.__version__)\""
    fi
}

# ── Step 6: Verify installation ────────────────────────────────────────────────
verify_install() {
    log "Verifying installation..."

    # Try to source setupvars if available
    for path in \
        /opt/intel/openvino_${OPENVINO_VERSION}/setupvars.sh \
        /opt/intel/openvino_2024/setupvars.sh \
        /opt/intel/openvino/setupvars.sh; do
        [ -f "$path" ] && source "$path" 2>/dev/null && break
    done

    local ver
    if ver=$(python3 -c "import openvino; print(openvino.__version__)" 2>/dev/null); then
        ok "OpenVINO Python: $ver"
    else
        warn "OpenVINO Python binding not accessible in current shell"
        warn "Run: source /opt/intel/openvino_2024/setupvars.sh"
    fi

    # Check available devices
    python3 - << 'PYEOF' 2>/dev/null && true
import openvino as ov
core = ov.Core()
devices = core.available_devices
print(f"  Available devices: {devices}")
for d in devices:
    try:
        name = core.get_property(d, "FULL_DEVICE_NAME")
        print(f"  → {d}: {name}")
    except:
        pass
PYEOF

    # Check OpenCL (GPU EP prerequisite)
    if command -v clinfo &>/dev/null; then
        if clinfo 2>/dev/null | grep -q "Number of platforms.*[1-9]"; then
            ok "OpenCL: available"
        else
            warn "OpenCL: no platforms (GPU EP may not work)"
        fi
    fi
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    echo ""
    echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}║     Intel OpenVINO — Ubuntu/Debian Installer            ║${NC}"
    echo -e "${BOLD}╠══════════════════════════════════════════════════════════╣${NC}"
    echo -e "  Version:  ${OPENVINO_VERSION}"
    echo -e "  Dist:     ${OPENVINO_APT_DIST}"
    echo -e "  Method:   ${INSTALL_METHOD}"
    echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""

    install_prerequisites

    if [[ "$INSTALL_METHOD" == "apt" ]]; then
        install_via_apt || { warn "apt failed, falling back to pip"; install_via_pip; }
    else
        install_via_pip
    fi

    # GPU runtime — only for Intel GPUs
    if [[ "${PLATFORM_GPU:-}" =~ ^intel || "${PLATFORM_CPU_VENDOR:-}" == "intel" ]]; then
        install_gpu_runtime
    fi

    install_python_extras
    setup_environment
    verify_install

    echo ""
    echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}${BOLD}║   OpenVINO installation complete!                       ║${NC}"
    echo -e "${GREEN}${BOLD}╠══════════════════════════════════════════════════════════╣${NC}"
    echo -e "${GREEN}  Next steps:${NC}"
    echo -e "  1. source /opt/intel/openvino_2024/setupvars.sh"
    echo -e "  2. Run:   make setup-model"
    echo -e "  3. Run:   make build-n5105   (or make build-dev)"
    echo -e "  4. Run:   make run"
    echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

main "$@"
