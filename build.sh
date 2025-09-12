#!/bin/bash
set -e

echo "Building Rice Stock Data MCP Server..."
echo "Node version: $(node --version)"
echo "NPM version: $(npm --version)"

# Clean any existing build
rm -rf dist/

# Install dependencies
echo "Installing dependencies..."
npm ci

# Build TypeScript
echo "Building TypeScript..."
npm run build

echo "Build completed successfully!"
ls -la dist/