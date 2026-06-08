# ============================================================
# Silverstar Grow ERP — Multi-stage Production Docker Image
# Build: docker build -t silverstar-grow:latest .
# Run:   docker run -p 5001:5001 --env-file server/.env silverstar-grow:latest
# ============================================================

# ── Stage 1: Build React frontend ────────────────────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /app/client

COPY client/package*.json ./
RUN npm ci --omit=dev

COPY client/ ./
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ── Stage 2: Production server image ─────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

# Install dumb-init for proper signal handling in containers
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Copy server dependencies
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev && npm cache clean --force

# Copy server source
COPY server/ ./server/

# Copy built frontend into server's public directory
# (Express serves this when SERVE_STATIC=true)
COPY --from=frontend-build /app/client/dist ./server/public/

# Create logs directory with correct permissions
RUN mkdir -p /app/logs && chown -R nodejs:nodejs /app

# Switch to non-root
USER nodejs

EXPOSE 5001

# Health check for Docker / ECS
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:5001/api/health || exit 1

# dumb-init wraps Node so signals (SIGTERM) are forwarded correctly
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server/index.js"]
