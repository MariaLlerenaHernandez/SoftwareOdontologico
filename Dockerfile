# Imagen única para despliegue en la nube (Render): la API en Go sirve
# también el frontend compilado, en un solo servicio web.

FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM golang:1.27-alpine AS api
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/sigo-api .

FROM alpine:3.20
RUN apk add --no-cache tzdata ca-certificates \
    && adduser -D -u 10001 sigo \
    && mkdir -p /data/uploads && chown sigo /data/uploads
COPY --from=api /out/sigo-api /usr/local/bin/sigo-api
COPY --from=web /web/dist /app/web
USER sigo
ENV STATIC_DIR=/app/web \
    UPLOAD_DIR=/data/uploads \
    APP_TIMEZONE=America/Guayaquil \
    PORT=8080
EXPOSE 8080
ENTRYPOINT ["sigo-api"]
