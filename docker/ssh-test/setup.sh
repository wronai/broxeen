#!/bin/bash
# Setup script for SSH test environment

set -e

echo "🔧 Setting up SSH test environment..."

# Generate SSH key pair for testing
if [ ! -f id_rsa ]; then
    echo "📝 Generating SSH key pair..."
    ssh-keygen -t rsa -b 4096 -f id_rsa -N "" -C "broxeen-test"
fi

# Create authorized_keys file
echo "📋 Creating authorized_keys..."
cp id_rsa.pub authorized_keys

# Create test data directory
mkdir -p test-data
echo "Test file for SSH operations" > test-data/test.txt
echo "Another test file" > test-data/test2.txt

# Build and start containers
echo "🐳 Building Docker containers..."
docker-compose build

echo "🚀 Starting SSH test servers..."
docker-compose up -d

# Wait for SSH to be ready
echo "⏳ Waiting for SSH servers to be ready..."
sleep 5

# Test SSH connection
echo "🧪 Testing SSH connection..."
ssh-keyscan -p 2222 localhost >> ~/.ssh/known_hosts 2>/dev/null || true
ssh-keyscan -p 2223 localhost >> ~/.ssh/known_hosts 2>/dev/null || true

if ssh -i id_rsa -p 2222 -o StrictHostKeyChecking=no testuser@localhost "echo 'SSH test successful'" 2>/dev/null; then
    echo "✅ SSH server 1 is ready (port 2222)"
else
    echo "⚠️  SSH server 1 not ready yet, trying password auth..."
    sshpass -p testpass ssh -p 2222 -o StrictHostKeyChecking=no testuser@localhost "echo 'SSH test successful'" || true
fi

if ssh -i id_rsa -p 2223 -o StrictHostKeyChecking=no testuser@localhost "echo 'SSH test successful'" 2>/dev/null; then
    echo "✅ SSH server 2 is ready (port 2223)"
else
    echo "⚠️  SSH server 2 not ready yet"
fi

echo ""
echo "✅ SSH test environment is ready!"
echo ""
echo "📝 Connection details:"
echo "   Server 1: ssh -i docker/ssh-test/id_rsa -p 2222 testuser@localhost"
echo "   Server 2: ssh -i docker/ssh-test/id_rsa -p 2223 testuser@localhost"
echo "   Password: testpass"
echo ""
echo "🧪 To run tests:"
echo "   pnpm test:e2e e2e/ssh-integration.spec.ts"
echo ""
echo "🛑 To stop:"
echo "   cd docker/ssh-test && docker-compose down"
