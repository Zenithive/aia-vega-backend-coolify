FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Native modules (e.g. better-sqlite3) need a compile toolchain during install.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Cache-friendly: install deps before copying full source
COPY package.json package-lock.json ./
RUN npm install

COPY . .

# Build admin/app, then drop devDependencies so node_modules is production-ready
RUN npm run build \
    && npm prune --omit=dev

FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=1337

# Reuse pruned node_modules from builder (no second npm install, no build tools here)
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules

# Strapi 5 outputs: build/ + .strapi/ (no dist/)
COPY --from=builder /app/build ./build
COPY --from=builder /app/.strapi ./.strapi
COPY --from=builder /app/config ./config
COPY --from=builder /app/src ./src
COPY --from=builder /app/database ./database
COPY --from=builder /app/public ./public
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/favicon.png ./favicon.png

EXPOSE 1337

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
    CMD node -e "const net=require('net');const port=process.env.PORT||1337;const s=net.connect({host:'127.0.0.1',port:Number(port)},()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>{s.destroy();process.exit(1)},4000);"

CMD ["npm", "run", "start"]