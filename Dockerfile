# Stage 1: build Vite frontend
FROM node:20-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: build Go backend (R2-backed, uses AWS SDK Go v2)
FROM golang:1.24-alpine AS backend
WORKDIR /app/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/main.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /platform-listing-server .

# Stage 3: minimal runtime image
FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=backend /platform-listing-server .
COPY --from=frontend /app/dist ./dist

ENV PORT=8080
# R2 credentials provided via docker-compose env_file
# R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET, R2_PUBLIC_BASE
EXPOSE 8080

CMD ["/app/platform-listing-server"]
