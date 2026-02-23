#!/usr/bin/env bash
# ============================================================
# install-openvino-docker.sh
# Uses official Intel OpenVINO Docker image.
# Also provides a helper to run broxeen-vision inside Docker.
# Useful when: you don't want system-level changes,
#              testing on any platform, CI/CD.
# ============================================================
set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${CYAN}[openvino-docker]${NC} $*"; }
ok()   { echo -e "${GREEN}[openvino-docker]${NC} ✓ $*"; }
warn() { echo -e "${YELLOW}[openvino-docker]${NC} ⚠ $*"; }
err()  { echo -e "${RED}[openvino-docker]${NC} ✗ $*"; exit 1; }

OPENVINO_VERSION="${OPENVINO_VERSION:-2024.4}"
OPENVINO_DOCKER_IMAGE="openvino/ubuntu22_runtime:${OPENVINO_VERSION}"
BROXEEN_DOCKER_IMAGE="broxeen-vision:latest"
PROJECT_DIR="$(pwd)"

# ── Check Docker ──────────────────────────────────────────────────────────────
check_docker() {
    command -v docker &>/dev/null || err "Docker not installed. Install from https://docs.docker.com/get-docker/"
    docker info &>/dev/null || err "Docker daemon not running. Start it first."
    ok "Docker available: $(docker --version)"
}

# ── Pull official OpenVINO image ──────────────────────────────────────────────
pull_openvino_image() {
    log "Pulling Intel OpenVINO Docker image..."
    docker pull "$OPENVINO_DOCKER_IMAGE"
    ok "Image ready: $OPENVINO_DOCKER_IMAGE"
}

# ── Test OpenVINO in Docker ───────────────────────────────────────────────────
test_in_docker() {
    log "Testing OpenVINO in Docker..."
    docker run --rm "$OPENVINO_DOCKER_IMAGE" python3 -c "
import openvino as ov
print(f'OpenVINO: {ov.__version__}')
core = ov.Core()
print(f'Devices: {core.available_devices}')
for d in core.available_devices:
    try:
        print(f'  {d}: {core.get_property(d, \"FULL_DEVICE_NAME\")}')
    except: pass
"
    ok "OpenVINO works in Docker"
}

# ── Generate Dockerfile for broxeen-vision ────────────────────────────────────
generate_dockerfile() {
    log "Generating Dockerfile for broxeen-vision..."
    cat > "$PROJECT_DIR/Dockerfile.openvino" << 'EOF'
# ── Stage 1: Rust + OpenVINO build environment ───────────────────────────────
FROM openvino/ubuntu22_runtime:2024.4 AS builder

# System deps
RUN apt-get update && apt-get install -y \
    curl git pkg-config libopencv-dev libclang-dev \
    build-essential cmake \
    && rm -rf /var/lib/apt/lists/*

# Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
    sh -s -- -y --default-toolchain stable
ENV PATH="/root/.cargo/bin:$PATH"

WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY src ./src/

# Build with OpenVINO feature
RUN cargo build --release --features openvino

# ── Stage 2: Minimal runtime ─────────────────────────────────────────────────
FROM openvino/ubuntu22_runtime:2024.4

RUN apt-get update && apt-get install -y \
    libopencv-dev ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/target/release/broxeen-vision /usr/local/bin/
COPY broxeen.toml /etc/broxeen/broxeen.toml

# Intel GPU device access
RUN usermod -aG render,video root 2>/dev/null || true

ENV BROXEEN__DATABASE__PATH=/data/monitoring.db
VOLUME /data
VOLUME /models

ENTRYPOINT ["broxeen-vision"]
CMD ["run"]
EOF
    ok "Generated: Dockerfile.openvino"
}

# ── Generate docker-compose.yml ───────────────────────────────────────────────
generate_compose() {
    log "Generating docker-compose.yml..."
    cat > "$PROJECT_DIR/docker-compose.openvino.yml" << 'EOF'
version: '3.8'

services:
  broxeen-cam1:
    image: broxeen-vision:latest
    container_name: broxeen-front-door
    restart: unless-stopped
    volumes:
      - ./data:/data
      - ./models:/models:ro
      - ./broxeen.toml:/etc/broxeen/broxeen.toml:ro
    environment:
      - OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
      - BROXEEN__CAMERA__URL=${CAM1_URL}
      - BROXEEN__CAMERA__CAMERA_ID=front-door
      - RUST_LOG=broxeen_vision=info
    # Intel GPU passthrough (for GPU EP)
    devices:
      - /dev/dri:/dev/dri
    group_add:
      - render
      - video
    network_mode: host

  broxeen-cam2:
    image: broxeen-vision:latest
    container_name: broxeen-back-door
    restart: unless-stopped
    volumes:
      - ./data:/data   # shared DB — queries work across cameras
      - ./models:/models:ro
      - ./broxeen.toml:/etc/broxeen/broxeen.toml:ro
    environment:
      - OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
      - BROXEEN__CAMERA__URL=${CAM2_URL}
      - BROXEEN__CAMERA__CAMERA_ID=back-door
      - BROXEEN__DATABASE__PATH=/data/monitoring.db
      - RUST_LOG=broxeen_vision=info
    devices:
      - /dev/dri:/dev/dri
    group_add:
      - render
      - video
    network_mode: host
    depends_on:
      - broxeen-cam1

  # Optional: query interface
  broxeen-query:
    image: broxeen-vision:latest
    container_name: broxeen-query
    profiles: ["query"]
    volumes:
      - ./data:/data
    environment:
      - OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
    stdin_open: true
    tty: true
    command: ["query"]
EOF
    ok "Generated: docker-compose.openvino.yml"
}

# ── Build broxeen Docker image ─────────────────────────────────────────────────
build_docker_image() {
    log "Building broxeen-vision Docker image..."
    [ -f "$PROJECT_DIR/Dockerfile.openvino" ] || generate_dockerfile
    docker build -f "$PROJECT_DIR/Dockerfile.openvino" -t "$BROXEEN_DOCKER_IMAGE" "$PROJECT_DIR"
    ok "Built: $BROXEEN_DOCKER_IMAGE"
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
    local cmd="${1:-help}"

    case "$cmd" in
        pull)    check_docker; pull_openvino_image ;;
        test)    check_docker; pull_openvino_image; test_in_docker ;;
        gen)     generate_dockerfile; generate_compose ;;
        build)   check_docker; build_docker_image ;;
        all)     check_docker; pull_openvino_image; test_in_docker; generate_dockerfile; generate_compose ;;
        *)
            echo -e "${BOLD}OpenVINO Docker Installer${NC}"
            echo ""
            echo "Usage: $0 [command]"
            echo ""
            echo "Commands:"
            echo "  pull    Pull official OpenVINO image"
            echo "  test    Test OpenVINO in Docker"
            echo "  gen     Generate Dockerfile + docker-compose.yml"
            echo "  build   Build broxeen-vision Docker image"
            echo "  all     Pull + test + gen"
            ;;
    esac
}

main "$@"
