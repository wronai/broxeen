#!/usr/bin/env bash
# ============================================================
# detect-platform.sh
# Auto-detects OS, CPU, GPU and recommends OpenVINO install
# Outputs: PLATFORM_OS, PLATFORM_ARCH, PLATFORM_CPU_VENDOR,
#          PLATFORM_GPU, OPENVINO_EP, OPENVINO_VERSION
# ============================================================
set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${CYAN}[detect]${NC} $*"; }
ok()   { echo -e "${GREEN}[detect]${NC} $*"; }
warn() { echo -e "${YELLOW}[detect]${NC} $*"; }
err()  { echo -e "${RED}[detect]${NC} $*"; }

# ── OS Detection ──────────────────────────────────────────────────────────────
detect_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if [ -f /etc/os-release ]; then
            # shellcheck source=/dev/null
            source /etc/os-release
            PLATFORM_OS_ID="${ID:-linux}"
            PLATFORM_OS_VER="${VERSION_ID:-unknown}"
            PLATFORM_OS_CODENAME="${VERSION_CODENAME:-}"
            case "$ID" in
                ubuntu)  PLATFORM_OS="ubuntu" ;;
                debian)  PLATFORM_OS="debian" ;;
                fedora)  PLATFORM_OS="fedora" ;;
                rhel|centos|rocky|almalinux) PLATFORM_OS="rhel" ;;
                opensuse*|sles) PLATFORM_OS="opensuse" ;;
                arch|manjaro)   PLATFORM_OS="arch" ;;
                raspbian)       PLATFORM_OS="raspbian" ;;
                *)              PLATFORM_OS="linux" ;;
            esac
        else
            PLATFORM_OS="linux"
            PLATFORM_OS_VER="unknown"
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        PLATFORM_OS="macos"
        PLATFORM_OS_VER=$(sw_vers -productVersion 2>/dev/null || echo "unknown")
    elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
        PLATFORM_OS="windows"
        PLATFORM_OS_VER=$(cmd.exe /c ver 2>/dev/null | tr -d '\r' || echo "unknown")
    else
        PLATFORM_OS="unknown"
        PLATFORM_OS_VER="unknown"
    fi

    # Check if running in WSL
    if grep -qi microsoft /proc/version 2>/dev/null; then
        PLATFORM_OS_EXTRA="wsl"
    elif [ -f /.dockerenv ]; then
        PLATFORM_OS_EXTRA="docker"
    else
        PLATFORM_OS_EXTRA=""
    fi

    export PLATFORM_OS PLATFORM_OS_VER PLATFORM_OS_ID PLATFORM_OS_EXTRA
    export PLATFORM_OS_CODENAME="${PLATFORM_OS_CODENAME:-}"
}

# ── Architecture Detection ─────────────────────────────────────────────────────
detect_arch() {
    PLATFORM_ARCH=$(uname -m)
    case "$PLATFORM_ARCH" in
        x86_64|amd64)   PLATFORM_ARCH="x86_64" ;;
        aarch64|arm64)  PLATFORM_ARCH="aarch64" ;;
        armv7l)         PLATFORM_ARCH="armv7" ;;
        *)              PLATFORM_ARCH="$PLATFORM_ARCH" ;;
    esac
    export PLATFORM_ARCH
}

# ── CPU Detection ─────────────────────────────────────────────────────────────
detect_cpu() {
    if [ -f /proc/cpuinfo ]; then
        CPU_MODEL=$(grep "model name" /proc/cpuinfo | head -1 | cut -d: -f2 | xargs)
        CPU_CORES=$(nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo)

        # Vendor
        CPU_VENDOR_ID=$(grep "vendor_id" /proc/cpuinfo | head -1 | cut -d: -f2 | xargs)
        case "$CPU_VENDOR_ID" in
            GenuineIntel*) PLATFORM_CPU_VENDOR="intel" ;;
            AuthenticAMD*) PLATFORM_CPU_VENDOR="amd" ;;
            ARM*)          PLATFORM_CPU_VENDOR="arm" ;;
            *)             PLATFORM_CPU_VENDOR="unknown" ;;
        esac
    elif [[ "$PLATFORM_OS" == "macos" ]]; then
        CPU_MODEL=$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "Apple Silicon")
        CPU_CORES=$(sysctl -n hw.logicalcpu 2>/dev/null || echo "?")
        if [[ "$CPU_MODEL" == *"Apple"* ]]; then
            PLATFORM_CPU_VENDOR="apple"
        else
            PLATFORM_CPU_VENDOR="intel"
        fi
    else
        CPU_MODEL="unknown"
        CPU_CORES="?"
        PLATFORM_CPU_VENDOR="unknown"
    fi

    # Detect specific Intel generations (for EP selection)
    INTEL_CPU_GEN="unknown"
    if [[ "$PLATFORM_CPU_VENDOR" == "intel" ]]; then
        if echo "$CPU_MODEL" | grep -qiE "N51[0-9]{2}|N60[0-9]{2}|N61[0-9]{2}"; then
            INTEL_CPU_GEN="jasper_lake"   # N5105, N6005 etc
        elif echo "$CPU_MODEL" | grep -qiE "N97|N100|N200|N305"; then
            INTEL_CPU_GEN="alder_lake_n"  # N97, N100 — has NPU
        elif echo "$CPU_MODEL" | grep -qiE "Core Ultra|Meteor Lake|Arrow Lake"; then
            INTEL_CPU_GEN="meteor_lake"   # has Intel NPU
        elif echo "$CPU_MODEL" | grep -qiE "12th|13th|14th|Core i[3579]-1[2-4]"; then
            INTEL_CPU_GEN="alder_raptor"
        elif echo "$CPU_MODEL" | grep -qiE "11th|Core i[3579]-11"; then
            INTEL_CPU_GEN="tiger_lake"
        elif echo "$CPU_MODEL" | grep -qiE "10th|Core i[3579]-10"; then
            INTEL_CPU_GEN="ice_lake"
        else
            INTEL_CPU_GEN="generic_intel"
        fi
    fi

    export PLATFORM_CPU_VENDOR CPU_MODEL CPU_CORES INTEL_CPU_GEN
}

# ── GPU Detection ─────────────────────────────────────────────────────────────
detect_gpu() {
    PLATFORM_GPU="none"
    GPU_MODEL="none"
    GPU_DRIVER="none"

    # Intel GPU (check DRM devices)
    if lspci 2>/dev/null | grep -qi "Intel.*graphics\|Intel.*display\|Intel.*VGA"; then
        PLATFORM_GPU="intel_igpu"
        GPU_MODEL=$(lspci 2>/dev/null | grep -i "Intel.*graphics\|Intel.*display" | head -1 | sed 's/.*: //')
        # Check Intel GPU driver
        if lsmod 2>/dev/null | grep -q "i915"; then
            GPU_DRIVER="i915"
        fi
    fi

    # NVIDIA (check before AMD — some machines have both)
    if lspci 2>/dev/null | grep -qi "NVIDIA"; then
        if command -v nvidia-smi &>/dev/null; then
            PLATFORM_GPU="nvidia"
            GPU_MODEL=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1 || echo "NVIDIA GPU")
            GPU_DRIVER=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null || echo "unknown")
        else
            PLATFORM_GPU="nvidia_no_driver"
        fi
    fi

    # AMD GPU
    if lspci 2>/dev/null | grep -qi "AMD.*Radeon\|ATI.*Radeon"; then
        PLATFORM_GPU="amd_gpu"
        GPU_MODEL=$(lspci 2>/dev/null | grep -i "Radeon" | head -1 | sed 's/.*: //')
    fi

    # Intel Arc discrete
    if lspci 2>/dev/null | grep -qi "Intel.*Arc\|Intel.*Battlemage"; then
        PLATFORM_GPU="intel_arc"
        GPU_MODEL=$(lspci 2>/dev/null | grep -i "Intel.*Arc" | head -1 | sed 's/.*: //')
    fi

    # macOS: Apple Silicon has unified GPU
    if [[ "$PLATFORM_OS" == "macos" && "$PLATFORM_CPU_VENDOR" == "apple" ]]; then
        PLATFORM_GPU="apple_gpu"
        GPU_MODEL="Apple Silicon GPU"
    fi

    export PLATFORM_GPU GPU_MODEL GPU_DRIVER
}

# ── OpenVINO Execution Provider Recommendation ────────────────────────────────
recommend_openvino_ep() {
    OPENVINO_EP="CPU"       # always available as fallback
    OPENVINO_VERSION="2024.4"
    OPENVINO_NOTES=""
    OPENVINO_INSTALL_METHOD="apt"

    case "$PLATFORM_OS" in
        ubuntu)
            case "$PLATFORM_OS_VER" in
                22.04*) OPENVINO_APT_DIST="ubuntu22" ;;
                24.04*) OPENVINO_APT_DIST="ubuntu24" ;;
                20.04*) OPENVINO_APT_DIST="ubuntu20" ;;
                *)      OPENVINO_APT_DIST="ubuntu22" ; OPENVINO_INSTALL_METHOD="pip" ;;
            esac
            ;;
        debian)  OPENVINO_APT_DIST="debian11"; OPENVINO_INSTALL_METHOD="pip" ;;
        rhel)    OPENVINO_INSTALL_METHOD="yum" ;;
        macos)   OPENVINO_INSTALL_METHOD="brew" ;;
        *)       OPENVINO_INSTALL_METHOD="pip" ;;
    esac

    # Select best EP based on hardware
    if [[ "$PLATFORM_CPU_VENDOR" == "intel" ]]; then
        OPENVINO_EP="GPU"
        OPENVINO_NOTES+="Intel iGPU detected — GPU EP will auto-select integrated graphics. "
        case "$INTEL_CPU_GEN" in
            jasper_lake)
                OPENVINO_NOTES+="N5105/N6005 (Jasper Lake UHD 24EU): GPU EP works well. "
                ;;
            alder_lake_n)
                OPENVINO_NOTES+="N97/N100 (Alder Lake-N): GPU + NPU EP available. "
                OPENVINO_EP="NPU"
                ;;
            meteor_lake)
                OPENVINO_NOTES+="Core Ultra (Meteor Lake): NPU EP recommended for inference. "
                OPENVINO_EP="NPU"
                ;;
            tiger_lake|ice_lake)
                OPENVINO_NOTES+="Tiger/Ice Lake Xe iGPU: GPU EP supported. "
                ;;
        esac
    fi

    if [[ "$PLATFORM_GPU" == "intel_arc" ]]; then
        OPENVINO_EP="GPU"
        OPENVINO_NOTES+="Intel Arc dGPU: GPU EP with full hardware acceleration. "
    fi

    if [[ "$PLATFORM_GPU" == "nvidia" ]]; then
        OPENVINO_NOTES+="NVIDIA GPU detected: OpenVINO will use CUDA EP via ort (not OpenVINO GPU). Consider using ort CUDA EP instead. "
    fi

    if [[ "$PLATFORM_CPU_VENDOR" == "amd" ]]; then
        OPENVINO_NOTES+="AMD CPU: OpenVINO CPU EP works (Intel-optimized). Consider ONNX CUDA EP if you have AMD GPU. "
        OPENVINO_EP="CPU"
    fi

    if [[ "$PLATFORM_CPU_VENDOR" == "apple" ]]; then
        OPENVINO_EP="CPU"
        OPENVINO_NOTES+="Apple Silicon: OpenVINO has limited support. Recommend CoreML EP or CPU. "
        OPENVINO_INSTALL_METHOD="pip"
    fi

    export OPENVINO_EP OPENVINO_VERSION OPENVINO_NOTES OPENVINO_INSTALL_METHOD
    export OPENVINO_APT_DIST="${OPENVINO_APT_DIST:-ubuntu22}"
}

# ── Print Report ──────────────────────────────────────────────────────────────
print_report() {
    echo ""
    echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BOLD}║           Platform Detection Report                     ║${NC}"
    echo -e "${BOLD}╠══════════════════════════════════════════════════════════╣${NC}"
    echo -e "  ${CYAN}OS:${NC}         $PLATFORM_OS $PLATFORM_OS_VER ${PLATFORM_OS_EXTRA:+[$PLATFORM_OS_EXTRA]}"
    echo -e "  ${CYAN}Arch:${NC}       $PLATFORM_ARCH"
    echo -e "  ${CYAN}CPU:${NC}        $CPU_MODEL ($CPU_CORES cores)"
    echo -e "  ${CYAN}CPU Vendor:${NC} $PLATFORM_CPU_VENDOR ${INTEL_CPU_GEN:+[$INTEL_CPU_GEN]}"
    echo -e "  ${CYAN}GPU:${NC}        $GPU_MODEL [$PLATFORM_GPU]"
    [[ "$GPU_DRIVER" != "none" ]] && echo -e "  ${CYAN}GPU Driver:${NC} $GPU_DRIVER"
    echo -e "${BOLD}╠══════════════════════════════════════════════════════════╣${NC}"
    echo -e "  ${GREEN}Recommended OpenVINO EP:${NC}     ${BOLD}$OPENVINO_EP${NC}"
    echo -e "  ${GREEN}OpenVINO Version:${NC}           $OPENVINO_VERSION"
    echo -e "  ${GREEN}Install Method:${NC}             $OPENVINO_INSTALL_METHOD"
    if [[ -n "$OPENVINO_NOTES" ]]; then
        echo -e "  ${YELLOW}Notes:${NC} $OPENVINO_NOTES"
    fi
    echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# ── Export to file (for use by other scripts) ─────────────────────────────────
export_vars() {
    local out="${1:-.platform-detection}"
    cat > "$out" << EOF
# Auto-generated by detect-platform.sh
PLATFORM_OS="$PLATFORM_OS"
PLATFORM_OS_VER="$PLATFORM_OS_VER"
PLATFORM_OS_EXTRA="${PLATFORM_OS_EXTRA:-}"
PLATFORM_ARCH="$PLATFORM_ARCH"
PLATFORM_CPU_VENDOR="$PLATFORM_CPU_VENDOR"
CPU_MODEL="$CPU_MODEL"
CPU_CORES="$CPU_CORES"
INTEL_CPU_GEN="${INTEL_CPU_GEN:-unknown}"
PLATFORM_GPU="$PLATFORM_GPU"
GPU_MODEL="$GPU_MODEL"
GPU_DRIVER="$GPU_DRIVER"
OPENVINO_EP="$OPENVINO_EP"
OPENVINO_VERSION="$OPENVINO_VERSION"
OPENVINO_INSTALL_METHOD="$OPENVINO_INSTALL_METHOD"
OPENVINO_APT_DIST="${OPENVINO_APT_DIST:-ubuntu22}"
EOF
    log "Platform info saved → $out"
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    log "Detecting platform..."
    detect_os
    detect_arch
    detect_cpu
    detect_gpu
    recommend_openvino_ep

    if [[ "${1:-}" == "--export" ]]; then
        export_vars "${2:-.platform-detection}"
    elif [[ "${1:-}" == "--quiet" ]]; then
        echo "$OPENVINO_EP"
    elif [[ "${1:-}" == "--json" ]]; then
        cat <<JSON
{
  "os": "$PLATFORM_OS",
  "os_version": "$PLATFORM_OS_VER",
  "arch": "$PLATFORM_ARCH",
  "cpu_vendor": "$PLATFORM_CPU_VENDOR",
  "cpu_model": "$CPU_MODEL",
  "cpu_cores": $CPU_CORES,
  "intel_cpu_gen": "${INTEL_CPU_GEN:-unknown}",
  "gpu": "$PLATFORM_GPU",
  "gpu_model": "$GPU_MODEL",
  "openvino_ep": "$OPENVINO_EP",
  "openvino_version": "$OPENVINO_VERSION",
  "install_method": "$OPENVINO_INSTALL_METHOD"
}
JSON
    else
        print_report
        export_vars
    fi
}

main "$@"
