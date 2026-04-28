# Use Playwright's official image so Chromium + all its X11/font deps are
# already preinstalled and version-matched to the playwright npm package.
# Mirrors restream-worker's "single tagged base + apt-install ffmpeg" shape.
FROM mcr.microsoft.com/playwright:v1.59.1-jammy

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
# --omit=dev keeps the image smaller. Playwright is a runtime dep here.
RUN npm install --omit=dev

COPY index.js ./

# Match the in-code default; can be overridden with -e PORT=...
EXPOSE 3101

CMD ["node", "index.js"]
