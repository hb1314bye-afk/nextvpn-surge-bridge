FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y curl ca-certificates tar && \
    ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then SB_ARCH="linux-amd64"; else SB_ARCH="linux-arm64"; fi && \
    curl -Lo sing-box.tar.gz "https://github.com/SagerNet/sing-box/releases/download/v1.9.7/sing-box-1.9.7-${SB_ARCH}.tar.gz" && \
    tar -xzf sing-box.tar.gz && \
    mv sing-box-1.9.7-${SB_ARCH}/sing-box /usr/local/bin/sing-box && \
    chmod +x /usr/local/bin/sing-box && \
    rm -rf sing-box* && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY package.json /app/package.json
COPY server.mjs /app/server.mjs

ENV PORT=10000
EXPOSE 10000

CMD ["node", "server.mjs"]
