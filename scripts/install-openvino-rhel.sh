#!/usr/bin/env bash
# ============================================================
# install-openvino-rhel.sh
# Installs Intel OpenVINO on Fedora, RHEL, Rocky, AlmaLinux
# ============================================================
set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${CYAN}[openvino]${NC} $*"; }
ok()   { echo -e "${GREEN}[openvino]${NC} ✓ $*"; }
warn() { echo -e "${YELLOW}[openvino]${NC} ⚠ $*"; }

OPENVINO_VERSION="${OPENVINO_VERSION:-2024.4}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$SCRIPT_DIR/../.platform-detection" ] && source "$SCRIPT_DIR/../.platform-detection"

# ── Detect package manager ────────────────────────────────────────────────────
if command -v dnf &>/dev/null; then PKG="dnf"
elif command -v yum &>/dev/null; then PKG="yum"
else PKG="dnf"; fi

# ── RHEL/CentOS version ───────────────────────────────────────────────────────
RHEL_VER=$(rpm -E %{rhel} 2>/dev/null || echo "8")

install_prerequisites() {
    log "Installing prerequisites..."
    sudo $PKG install -y -q \
        curl wget gnupg2 ca-certificates \
        python3 python3-pip python3-devel \
        mesa-libGL glib2 \
        libgomp
    ok "Prerequisites installed"
}

install_via_yum_repo() {
    log "Adding Intel OpenVINO YUM repository..."

    cat | sudo tee /etc/yum.repos.d/intel-openvino.repo << 'EOF'
[intel-openvino-2024]
name=Intel OpenVINO 2024
baseurl=https://yum.repos.intel.com/openvino/2024
enabled=1
gpgcheck=1
gpgkey=https://yum.repos.intel.com/intel-gpg-keys/GPG-PUB-KEY-INTEL-SW-PRODUCTS.PUB
EOF

    sudo $PKG update -q
    sudo $PKG install -y "openvino-${OPENVINO_VERSION}" || \
        sudo $PKG install -y openvino
    ok "OpenVINO installed via YUM/DNF"
}

install_via_pip() {
    log "Installing OpenVINO via pip..."
    pip3 install -q --upgrade pip
    pip3 install -q "openvino==${OPENVINO_VERSION}" || pip3 install -q openvino
    ok "OpenVINO installed via pip"
}

install_gpu_runtime() {
    log "Installing Intel GPU runtime..."
    # NEO for RHEL
    sudo $PKG install -y intel-opencl intel-level-zero-gpu 2>/dev/null || \
        warn "Intel GPU runtime packages not available via dnf — skipping"
}

setup_environment() {
    local setupvars
    setupvars=$(find /opt/intel -name "setupvars.sh" 2>/dev/null | sort -V | tail -1 || echo "")
    if [ -n "$setupvars" ]; then
        grep -q "OpenVINO" ~/.bashrc 2>/dev/null || echo "source $setupvars" >> ~/.bashrc
        ok "Added to ~/.bashrc: source $setupvars"
    fi
}

verify_install() {
    python3 -c "import openvino as ov; print('OpenVINO', ov.__version__); core = ov.Core(); print('Devices:', core.available_devices)" 2>/dev/null || \
        warn "Verify manually: python3 -c 'import openvino; print(openvino.__version__)'"
}

main() {
    echo -e "${BOLD}Intel OpenVINO — RHEL/Fedora Installer (v${OPENVINO_VERSION})${NC}"
    echo ""
    install_prerequisites
    install_via_yum_repo || { warn "YUM repo failed, trying pip"; install_via_pip; }
    [[ "${PLATFORM_CPU_VENDOR:-}" == "intel" ]] && install_gpu_runtime
    setup_environment
    verify_install
    ok "Done. Run: source ~/.bashrc && make build-n5105"
}

main "$@"
