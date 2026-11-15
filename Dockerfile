FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts vitest.config.ts ./
COPY src ./src
COPY tests ./tests
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATA_DIR=/app/.data STATIC_DIR=dist/client
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir -p /app/.data && chown node:node /app/.data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health',{headers:{'x-mythic-origin':process.env.ORIGIN_SECRET||''}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server/index.cjs"]
