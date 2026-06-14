# Stage 1: build Vite frontend
FROM node:20-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: build Go backend
FROM golang:1.22-alpine AS backend
WORKDIR /app/server
COPY server/go.mod ./
RUN go mod download
COPY server/main.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /platform-listing-server .

# Stage 3: minimal runtime image
FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=backend /platform-listing-server .
COPY --from=frontend /app/dist ./dist
RUN mkdir -p uploads

ENV PORT=8080
ENV BASE_URL=""
EXPOSE 8080

CMD ["/app/platform-listing-server"]
