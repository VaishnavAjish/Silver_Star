#!/bin/bash
set -e

echo "Starting Deployment for Silverstar Grow..."

echo "[1/7] Pulling latest code..."
git pull origin master

# ── Auto-bump patch version ────────────────────────────────────────────────────
echo "[2/7] Auto-bumping version..."
CURRENT=$(node -p "require('./package.json').version")
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"
PATCH=$((PATCH + 1))
NEW_VERSION="$MAJOR.$MINOR.$PATCH"

# Update root package.json
sed -i "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW_VERSION\"/" package.json
# Update client package.json
sed -i "s/\"version\": \"$CURRENT\"/\"version\": \"$NEW_VERSION\"/" client/package.json

echo "   Version bumped: $CURRENT → $NEW_VERSION"

# Auto-commit the version bump so sidebar always shows the latest
git add package.json client/package.json
git commit -m "chore: auto-bump version to $NEW_VERSION" --no-verify || true

echo "[3/7] Installing dependencies..."
npm install
cd client && npm install && cd ..
cd server && npm install && cd ..

echo "[4/7] Running server test suite..."
# Gate: a failing suite aborts the deploy via `set -e`, before anything is built
# or copied. Runs one file per process because `node --test` misbehaves when
# handed several files at once. Skips *.live.test.js — those need a real
# database, and this script runs on the production box.
# `timeout` bounds a stuck test so it fails the deploy instead of hanging it.
(cd server && timeout 600 npm run test:ci)

echo "[5/7] Building frontend and updating static assets..."
# Runs the root build script which handles building client and moving to server/public
npm run build

echo "[6/7] Copying frontend assets to NGINX web root..."
sudo rm -rf /var/www/silverstar/*
sudo cp -r client/dist/* /var/www/silverstar/

echo "[7/7] Reloading API via PM2..."
pm2 reload silverstar-api

echo "Deployment complete! Version: $NEW_VERSION"

