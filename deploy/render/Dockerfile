# One container for Render: the Go API, the Next.js console, and nginx in
# front of both on Render's $PORT. nginx sends /api, /ws, and /healthz to Go
# (WebSockets and Server-Sent Events need that) and everything else to Next.js,
# the same split as deploy/nginx.frontend-primary.conf.
#
# Build from the repository root: docker build -f deploy/render/Dockerfile .

FROM golang:1.26-bookworm AS api
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/qnetward ./cmd/qnetward

FROM node:22-bookworm-slim AS web
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH" NEXT_TELEMETRY_DISABLED=1
# Same pnpm as CI; the newest one refuses the build scripts we deliberately skip.
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /app
COPY apps/web/package.json apps/web/pnpm-lock.yaml apps/web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY apps/web ./
RUN pnpm build

FROM node:22-bookworm-slim
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates nginx-light \
	&& rm -rf /var/lib/apt/lists/* \
	&& rm -f /etc/nginx/sites-enabled/default
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
	QNETWARD_LISTEN=127.0.0.1:8080 \
	QNETWARD_BACKEND_URL=http://127.0.0.1:8080
WORKDIR /app
COPY --from=api /out/qnetward /app/qnetward
COPY --from=web /app/.next/standalone /app/web
COPY --from=web /app/.next/static /app/web/.next/static
COPY --from=web /app/public /app/web/public
COPY deploy/render/nginx.conf.template /app/nginx.conf.template
COPY deploy/render/start.sh /app/start.sh
RUN chmod +x /app/start.sh
EXPOSE 10000
CMD ["/app/start.sh"]
