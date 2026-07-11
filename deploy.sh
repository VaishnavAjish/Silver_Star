#!/bin/bash
set -e

echo "Starting Deployment for Silverstar Grow..."

echo "[1/4] Pulling latest code..."
git pull origin master

echo "[2/4] Installing dependencies..."
npm install
cd client && npm install && cd ..
cd server && npm install && cd ..

echo "[3/4] Building frontend and updating static assets..."
# Runs the root build script which handles building client and moving to server/public
npm run build

echo "[3.5/4] Copying frontend assets to NGINX web root..."
sudo rm -rf /var/www/silverstar/*
sudo cp -r client/dist/* /var/www/silverstar/

echo "[4/4] Reloading API via PM2..."
pm2 reload silverstar-api

echo "Deployment complete!"
