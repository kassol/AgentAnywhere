FROM oven/bun:1.3.10 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
RUN bun run build && bun run typecheck

FROM oven/bun:1.3.10
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --from=build /app/dist ./dist
COPY src/server.ts ./src/server.ts
COPY src/model-connection.ts ./src/model-connection.ts
COPY src/work.ts ./src/work.ts
COPY licenses ./licenses
USER bun
ENV AGENTANYWHERE_HOST=0.0.0.0 AGENTANYWHERE_PORT=3000
EXPOSE 3000
CMD ["bun", "src/server.ts"]
