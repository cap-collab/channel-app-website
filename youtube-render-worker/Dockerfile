# Use Playwright's official image so Chromium + all its X11/font deps are
# already preinstalled and version-matched to the playwright npm package.
# Mirrors restream-worker's "single tagged base + apt-install ffmpeg" shape.
FROM mcr.microsoft.com/playwright:v1.59.1-jammy

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# --- whisper.cpp: build the CLI + bake in the base.en model ---
# Powers POST /transcribe (the /tape "Transcribe" admin action → field-note
# captions). Built from a pinned tag; binary → /usr/local/bin/whisper-cli, and
# the ~148MB base.en model dropped at $WHISPER_MODEL_PATH. Build deps are purged
# after to keep the image lean. CPU-only inference at runtime.
ENV WHISPER_MODEL_PATH=/opt/whisper/ggml-base.en.bin
RUN apt-get update && \
    apt-get install -y --no-install-recommends git build-essential cmake curl ca-certificates && \
    git clone --depth 1 --branch v1.7.2 https://github.com/ggerganov/whisper.cpp /tmp/whisper.cpp && \
    cmake -S /tmp/whisper.cpp -B /tmp/whisper.cpp/build -DCMAKE_BUILD_TYPE=Release && \
    cmake --build /tmp/whisper.cpp/build --config Release -j --target whisper-cli && \
    cp /tmp/whisper.cpp/build/bin/whisper-cli /usr/local/bin/whisper-cli && \
    mkdir -p /opt/whisper && \
    curl -fsSL -o "$WHISPER_MODEL_PATH" \
      https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin && \
    rm -rf /tmp/whisper.cpp && \
    apt-get purge -y git build-essential cmake && apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
# --omit=dev keeps the image smaller. Playwright is a runtime dep here.
RUN npm install --omit=dev

COPY index.js ./

# Match the in-code default; can be overridden with -e PORT=...
EXPOSE 3101

CMD ["node", "index.js"]
