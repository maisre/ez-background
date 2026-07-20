# Debian (glibc), not Alpine: Playwright's Chromium and sharp's prebuilt
# binaries target glibc — Alpine/musl needs fiddly workarounds.
FROM node:20-bookworm-slim AS build

WORKDIR /app

# Skip Playwright's automatic browser download during install — the browser is
# installed explicitly (with system libs) in the runtime stage.
COPY package*.json ./
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci

COPY . .
RUN npm run build

FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --omit=dev

# Install the exact Chromium build this Playwright version expects, plus its
# OS library dependencies (--with-deps runs apt-get; needs root, which is the
# default user here). The screenshot service launches with --no-sandbox, so
# running as root in-container is fine.
RUN npx playwright install --with-deps chromium \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/dist ./dist

EXPOSE 3002

CMD ["node", "dist/main"]
