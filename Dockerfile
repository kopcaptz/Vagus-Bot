# ============================================
# Stage 1: Build (TypeScript -> JavaScript)
# ============================================
FROM node:22-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/
RUN npm run build

# ============================================
# Stage 2: Production
# ============================================
FROM node:22-alpine

WORKDIR /app

# better-sqlite3 requires native compilation -- install build tools, build, remove
COPY package.json package-lock.json ./
RUN apk add --no-cache python3 make g++ && \
    npm ci --omit=dev && \
    apk del python3 make g++ && \
    rm -rf /root/.npm /tmp/*

# Copy compiled JS and static files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

# Copy env example for reference
COPY .env.example ./

# Create directories for persistent data
RUN mkdir -p data workspace

EXPOSE 3000

CMD ["node", "dist/index.js"]
