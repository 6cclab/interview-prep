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

# whisper-cli and its model are mounted rather than baked: the model is
# hundreds of megabytes and changes on a different cadence than this image.
ENV WHISPER_BINARY=/opt/whisper/whisper-cli \
    WHISPER_MODEL=/opt/whisper/models/ggml-base.en.bin

EXPOSE 4173
CMD ["node", "--experimental-strip-types", "voice/http-server.ts"]
