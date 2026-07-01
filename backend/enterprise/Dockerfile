FROM golang:1.25-alpine
WORKDIR /app
COPY go.mod ./
RUN go mod download
COPY . .
EXPOSE 8081
CMD ["go", "run", "./cmd/server"]
