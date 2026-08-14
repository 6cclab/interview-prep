# The drill server, for a deployed instance.
#
# Deployed mode differs from local in what it does NOT need: no mkcert (Traefik
# terminates TLS), no `open` (there is no desktop), and no vitest (the browser
# runs the suites, which is the whole of Stage 2). What it still needs is
# whisper for speech-to-text and ffmpeg to transcode what the browser uploads.

FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
# Manifests first so a dependency install is cached across source edits.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build:web

# whisper-cli, built here rather than mounted.
#
# It was a mounted PVC, which works in the cluster and makes the image useless
# on a laptop: a macOS whisper-cli cannot be bind-mounted into a linux
# container, so every spoken turn failed with nothing to point at. Built in, the
# same image runs both places.
#
# Static, so the runtime stage needs no libwhisper/libggml alongside it.
FROM debian:12-slim AS whisper
RUN apt-get update \
 && apt-get install -y --no-install-recommends git build-essential cmake ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ARG WHISPER_REF=v1.7.4
RUN git clone --depth 1 --branch "$WHISPER_REF" https://github.com/ggml-org/whisper.cpp /src \
 && cmake -S /src -B /build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF \
      -DWHISPER_BUILD_EXAMPLES=ON -DGGML_NATIVE=OFF \
 && cmake --build /build --target whisper-cli -j "$(nproc)"

FROM node:24-slim AS runtime
WORKDIR /app
RUN corepack enable

# ffmpeg transcodes the browser's webm before whisper sees it, and is also
# ffplay's package — piper's player locally. Kept even though deployed mode
# does not speak, because transcode.ts needs it on every turn.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/voice/dist ./voice/dist
# The exercise content is baked in and read-only: problems, worked answers,
# prompts, rubrics. Only `local/users/` is mutable, and it is a mounted volume.
COPY . .

ENV NODE_ENV=production \
    VOICE_MODE=deployed \
    PORT=4173

COPY --from=whisper /build/bin/whisper-cli /usr/local/bin/whisper-cli

# The binary is baked; the model is not. A model is hundreds of megabytes to a
# couple of gigabytes and changes on a different cadence than this image — the
# cluster mounts it from a PVC, a laptop bind-mounts `models/` from the repo.
ENV WHISPER_BINARY=/usr/local/bin/whisper-cli \
    WHISPER_MODEL=/opt/whisper/models/ggml-large-v3-turbo.bin

EXPOSE 4173
# tsx, not `node --experimental-strip-types`: the server's imports are
# extensionless (`./identity`, not `./identity.ts`) and node's ESM resolver
# will not complete them. tsx is what every local script already runs on, so
# this is the same loader the tests exercise.
CMD ["node_modules/.bin/tsx", "voice/http-server.ts"]
