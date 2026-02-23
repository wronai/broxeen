# SSH Test Environment

Docker-based SSH test environment for Broxeen integration tests.

## Quick Start

```bash
# Setup and start SSH test servers
cd docker/ssh-test
chmod +x setup.sh
./setup.sh

# Run SSH integration tests
cd ../..
pnpm test:e2e e2e/ssh-docker.spec.ts
```

## Architecture

- **ssh-server** (port 2222): Primary SSH test server
- **ssh-server-2** (port 2223): Secondary server for multi-host testing
- **Network**: 172.28.0.0/16 bridge network

## Test Credentials

- **Username**: testuser
- **Password**: testpass
- **SSH Key**: `docker/ssh-test/id_rsa`

## Manual Testing

```bash
# Connect to server 1
ssh -i docker/ssh-test/id_rsa -p 2222 testuser@localhost

# Connect to server 2
ssh -i docker/ssh-test/id_rsa -p 2223 testuser@localhost

# Or with password
ssh -p 2222 testuser@localhost
# Password: testpass
```

## Test Commands

```bash
# Test uptime
ssh -i docker/ssh-test/id_rsa -p 2222 testuser@localhost uptime

# Test disk usage
ssh -i docker/ssh-test/id_rsa -p 2222 testuser@localhost df -h

# Test memory
ssh -i docker/ssh-test/id_rsa -p 2222 testuser@localhost free -h

# Test processes
ssh -i docker/ssh-test/id_rsa -p 2222 testuser@localhost "ps aux | head -10"
```

## Broxeen SSH Commands

Test these in the Broxeen app:

```
# Direct SSH
ssh localhost port 2222 user testuser uptime

# Text2SSH (natural language)
text2ssh localhost port 2222 ile pamięci
text2ssh localhost port 2222 sprawdź dysk
text2ssh localhost port 2222 jakie procesy działają

# Test connection
test ssh localhost port 2222 user testuser

# List known hosts
ssh hosty
```

## Cleanup

```bash
cd docker/ssh-test
docker-compose down
docker-compose down -v  # Remove volumes too
```

## Troubleshooting

### SSH connection refused
```bash
# Check if containers are running
docker ps | grep broxeen-ssh

# Check logs
docker logs broxeen-ssh-test

# Restart containers
docker-compose restart
```

### Permission denied
```bash
# Fix SSH key permissions
chmod 600 docker/ssh-test/id_rsa
chmod 644 docker/ssh-test/id_rsa.pub

# Try password authentication
ssh -p 2222 testuser@localhost
# Password: testpass
```

### Known hosts issues
```bash
# Clear known hosts for test servers
ssh-keygen -R "[localhost]:2222"
ssh-keygen -R "[localhost]:2223"

# Re-add
ssh-keyscan -p 2222 localhost >> ~/.ssh/known_hosts
ssh-keyscan -p 2223 localhost >> ~/.ssh/known_hosts
```

## Integration with Broxeen Tests

The E2E tests in `e2e/ssh-docker.spec.ts` verify:

1. ✅ SSH command execution
2. ✅ Text2SSH natural language processing
3. ✅ SSH connection testing
4. ✅ Known hosts listing
5. ✅ LLM analysis of SSH output
6. ✅ LLM-generated SSH commands
7. ✅ Error handling (invalid host, auth failures)

## CI/CD Integration

Add to GitHub Actions workflow:

```yaml
- name: Setup SSH test environment
  run: |
    cd docker/ssh-test
    chmod +x setup.sh
    ./setup.sh

- name: Run SSH integration tests
  run: pnpm test:e2e e2e/ssh-docker.spec.ts
  env:
    VITE_OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}

- name: Cleanup SSH test environment
  if: always()
  run: |
    cd docker/ssh-test
    docker-compose down
```
