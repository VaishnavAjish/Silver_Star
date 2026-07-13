#!/bin/bash
set -e

echo "Starting Deployment for Silverstar Grow..."

echo "[1/6] Pulling latest code..."
git pull origin master

# ── Auto-bump patch version ────────────────────────────────────────────────────
echo "[2/6] Auto-bumping version..."
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

echo "[3/6] Installing dependencies..."
npm install
cd client && npm install && cd ..
cd server && npm install && cd ..

echo "[4/6] Building frontend and updating static assets..."
# Runs the root build script which handles building client and moving to server/public
npm run build

echo "[5/6] Copying frontend assets to NGINX web root..."
sudo rm -rf /var/www/silverstar/*
sudo cp -r client/dist/* /var/www/silverstar/

echo "[6/6] Reloading API via PM2..."
pm2 reload silverstar-api

echo "Deployment complete! Version: $NEW_VERSION"

