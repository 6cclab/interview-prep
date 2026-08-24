# The drill server, for a deployed instance.
#
# Deployed mode differs from local in what it does NOT need: no mkcert (a proxy
# terminates TLS), no `open` (there is no desktop), and no server-side vitest —
# the browser runs the suites. What it still needs is whisper for speech-to-text
# and ffmpeg to transcode what the browser uploads, plus piper to synthesise the
# interviewer's replies for the browser to play.
#
# It also now needs Postgres, which is not in this image and should not be: the
# database holds every person's work and outlives any container. See
# `deploy/compose.yaml` for a stack that runs both, and `deploy/README.md` for
# what has to be set before it will start.

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

# ffmpeg transcodes the browser's webm before whisper sees it. `ffplay` comes
# in the same package and is piper's player *locally*; nothing here plays
# audio, so it is along for the ride rather than a requirement — see
# `checkSynthEngine`, which deliberately does not ask for it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/voice/dist ./voice/dist
# The exercise content is baked in and read-only: problems, worked answers,
# prompts, rubrics. `.dockerignore` keeps `local/` out — in deployed mode there
# is no `local/` at all, because every person's work is in Postgres.
#
# `problems/` is still baked even though a deployed instance serves definitions
# from the database. It is what `pnpm ingest` reads: the repo is the source of
# truth and the database is a serving copy, so the image has to carry the copy
# it will ingest from.
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

# piper, so the interviewer has a voice that is the same for everyone.
#
# The alternative is the browser's own `SpeechSynthesis`, which still works and
# is still the fallback — but it is a lottery per browser and operating system,
# and Chrome on Linux frequently has no local English voice at all. A binary
# release rather than a build: piper is C++ with an onnxruntime dependency, and
# compiling it here would add more to the build than the whole whisper stage.
#
# `TARGETARCH` is Docker's, set by buildx. Named explicitly because this repo is
# developed on an arm64 Mac and deployed to x86_64, and a build that silently
# fetched the wrong one would fail as "piper is not on PATH" — which reads as a
# missing install rather than a wrong architecture.
ARG PIPER_VERSION=2023.11.14-2
ARG TARGETARCH
RUN set -eux; \
    case "$TARGETARCH" in \
      amd64) piper_arch=x86_64 ;; \
      arm64) piper_arch=aarch64 ;; \
      *) echo "no piper release for TARGETARCH=$TARGETARCH" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/piper.tar.gz \
      "https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_${piper_arch}.tar.gz"; \
    tar -xzf /tmp/piper.tar.gz -C /opt; \
    rm /tmp/piper.tar.gz; \
    ln -s /opt/piper/piper /usr/local/bin/piper; \
    piper --help >/dev/null 2>&1 || true

# The voice model is mounted, not baked, for the same reason whisper's is: tens
# of megabytes on a different release cadence than this image. Unset or missing,
# the server says so at startup and the browser uses its own voice instead — a
# worse voice is a better outcome than refusing to serve a drill.
ENV PIPER_VOICE=/opt/piper/voices/en_US-lessac-medium.onnx

# Set at run time, never here. `DATABASE_URL`, `AUTH_SECRET` and `AUTH_BASE_URL`
# are all required and none is defaulted — a secret baked into an image is the
# same secret on every deployment of it, which is the same as having none.

EXPOSE 4173
# tsx, not `node --experimental-strip-types`: the server's imports are
# extensionless (`./identity`, not `./identity.ts`) and node's ESM resolver
# will not complete them. tsx is what every local script already runs on, so
# this is the same loader the tests exercise.
CMD ["node_modules/.bin/tsx", "voice/http-server.ts"]
