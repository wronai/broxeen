#!/bin/bash

# Broxeen Docker Testing Script
# Usage: ./scripts/test-docker.sh [unit|e2e|all]

set -e

TEST_TYPE=${1:-all}
PROJECT_NAME="broxeen"

echo "🐳 Starting Broxeen Docker Testing..."
echo "Test type: $TEST_TYPE"
echo "Project: $PROJECT_NAME"
echo "================================"

# Function to cleanup
cleanup() {
    echo "🧹 Cleaning up containers..."
    docker-compose -p $PROJECT_NAME down --volumes --remove-orphans
}

# Trap cleanup on exit
trap cleanup EXIT

# Build and run based on test type
case $TEST_TYPE in
    "unit")
        echo "🧪 Running Unit Tests in Docker..."
        docker-compose -p $PROJECT_NAME build broxeen-test
        docker-compose -p $PROJECT_NAME up --abort-on-container-exit broxeen-test
        ;;
    
    "e2e")
        echo "🎭 Running E2E Tests in Docker..."
        
        # Start dev server first
        echo "🚀 Starting development server..."
        docker-compose -p $PROJECT_NAME --profile dev up -d
        
        # Wait for server to be ready
        echo "⏳ Waiting for server to be ready..."
        timeout 60 bash -c 'until curl -f http://localhost:5173/ > /dev/null 2>&1; do sleep 2; done'
        
        # Run E2E tests
        echo "🎭 Running Playwright tests..."
        docker-compose -p $PROJECT_NAME --profile e2e build broxeen-e2e
        docker-compose -p $PROJECT_NAME --profile e2e up --abort-on-container-exit broxeen-e2e
        
        # Show test results
        echo "📊 Test Results:"
        if [ -d "./playwright-report" ]; then
            echo "Playwright report available in ./playwright-report/"
            ls -la ./playwright-report/
        fi
        
        if [ -d "./test-results" ]; then
            echo "Test artifacts available in ./test-results/"
            ls -la ./test-results/
        fi
        ;;
    
    "all")
        echo "🔄 Running All Tests in Docker..."
        
        # Run unit tests first
        echo "🧪 Unit Tests:"
        docker-compose -p $PROJECT_NAME build broxeen-test
        docker-compose -p $PROJECT_NAME up --abort-on-container-exit broxeen-test
        
        echo ""
        echo "🎭 E2E Tests:"
        
        # Start dev server
        docker-compose -p $PROJECT_NAME --profile dev up -d broxeen-dev
        
        # Wait for server
        timeout 60 bash -c 'until curl -f http://localhost:5173/ > /dev/null 2>&1; do sleep 2; done'
        
        # Run E2E tests
        docker-compose -p $PROJECT_NAME build broxeen-e2e
        docker-compose -p $PROJECT_NAME up --abort-on-container-exit broxeen-e2e
        
        # Show results
        echo ""
        echo "📊 All Test Results:"
        if [ -d "./playwright-report" ]; then
            echo "E2E Report: ./playwright-report/"
        fi
        if [ -d "./test-results" ]; then
            echo "E2E Artifacts: ./test-results/"
        fi
        ;;
    
    *)
        echo "❌ Unknown test type: $TEST_TYPE"
        echo "Usage: $0 [unit|e2e|all]"
        exit 1
        ;;
esac

echo ""
echo "✅ Docker testing completed!"
echo "================================"
