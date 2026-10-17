# SkillBridge on Cloud Run: Next.js app + engine + agent runner, SQLite baked into the image.
# Build context is the repo root; the app resolves data as ../data from /srv/app.
FROM node:24-slim
WORKDIR /srv/app
ENV NEXT_TELEMETRY_DISABLED=1
COPY app/package.json app/package-lock.json ./
RUN npm ci
COPY app/ ./
COPY data/ /srv/data/
RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production
EXPOSE 3012
CMD ["npm", "start"]
