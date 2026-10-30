FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/sigo-api .

FROM alpine:3.20
RUN apk add --no-cache tzdata ca-certificates && adduser -D -u 10001 sigo && mkdir -p /data/uploads && chown sigo /data/uploads
USER sigo
COPY --from=build /out/sigo-api /usr/local/bin/sigo-api
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["sigo-api"]
