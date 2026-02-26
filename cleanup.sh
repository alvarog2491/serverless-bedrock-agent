#!/bin/bash

# cleanup.sh - Remove all build artifacts and generated files from CDK deployment
# Usage: ./cleanup.sh

set -e  # Exit on error

echo "🧹 Starting cleanup of build artifacts..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to safely remove directory
remove_dir() {
    if [ -d "$1" ]; then
        echo -e "${YELLOW}Removing directory: $1${NC}"
        rm -rf "$1"
        echo -e "${GREEN}✓ Removed $1${NC}"
    else
        echo -e "${YELLOW}Directory not found (skipping): $1${NC}"
    fi
}

# Function to safely remove files by pattern
remove_files() {
    local pattern=$1
    local description=$2
    # Exclude node_modules from search
    local count=$(find . -name "$pattern" -type f -not -path "*/node_modules/*" 2>/dev/null | wc -l | tr -d ' ')
    
    if [ "$count" -gt 0 ]; then
        echo -e "${YELLOW}Removing $description ($count files)...${NC}"
        find . -name "$pattern" -type f -not -path "*/node_modules/*" -delete
        echo -e "${GREEN}✓ Removed $count $description${NC}"
    else
        echo -e "${YELLOW}No $description found (skipping)${NC}"
    fi
}

echo ""
echo "📦 Removing CDK build artifacts..."
remove_dir "cdk.out"

echo ""
echo "🔨 Removing TypeScript compiled files..."
remove_files "*.js" "JavaScript files"
remove_files "*.d.ts" "TypeScript declaration files"
remove_files "*.js.map" "JavaScript source maps"

echo ""
echo "📁 Removing specific build directories..."
remove_dir "lib/**/*.js"
remove_dir "bin/**/*.js"

echo ""
echo "🗑️  Removing temporary files..."
remove_files "*.tsbuildinfo" "TypeScript build info files"
remove_files ".DS_Store" "macOS metadata files"

echo ""
echo "🐍 Removing Python cache files..."
# Find and remove all __pycache__ directories
find . -name "__pycache__" -type d -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null || true
echo -e "${GREEN}✓ Removed __pycache__ directories${NC}"

echo ""
echo "📊 Removing coverage and test artifacts (if any)..."
remove_dir "coverage"
remove_dir ".nyc_output"
remove_dir ".pytest_cache"

echo ""
echo -e "${GREEN}✅ Cleanup complete!${NC}"
echo ""
echo "ℹ️  Note: This script does NOT remove:"
echo "   - node_modules/ (run 'rm -rf node_modules' if needed)"
echo "   - .env files (configuration preserved)"
echo "   - assets/ (your source data preserved)"
echo ""
echo "To rebuild the project, run: npm run build"
