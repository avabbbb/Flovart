# 🐳 Docker 部署完整指南

本指南提供了 Flovart 项目的详�?Docker 部署说明�?

---

## 📋 目录

- [前置要求](#前置要求)
- [快速开始](#快速开�?
- [详细配置](#详细配置)
- [生产环境部署](#生产环境部署)
- [常见问题](#常见问题)
- [故障排查](#故障排查)

---

## 🎯 前置要求

### 必需安装

- **Docker**: 版本 20.10 或更�?
- **Docker Compose**: 版本 1.29 或更高（V2版本更佳�?

### 验证安装

```bash
# 检�?Docker 版本
docker --version
# 输出示例: Docker version 24.0.0

# 检�?Docker Compose 版本
docker-compose --version
# 输出示例: Docker Compose version v2.20.0
```

### 系统要求

- **最小配�?*:
  - CPU: 1 核心
  - 内存: 512 MB
  - 磁盘: 1 GB

- **推荐配置**:
  - CPU: 2 核心
  - 内存: 1 GB
  - 磁盘: 2 GB

---

## 🚀 快速开�?

### 方法 1：使�?Docker Compose（推荐）

```bash
# 1. 克隆项目
git clone https://github.com/your-username/Flovart.git
cd Flovart

# 2. 启动服务（自动构建）
docker-compose up -d

# 3. 查看日志（确保启动成功）
docker-compose logs -f

# 4. 访问应用
# 打开浏览器访�? http://localhost:3000
```

### 方法 2：使�?Docker CLI

```bash
# 1. 构建镜像
docker build -t flovart:latest -f docker/Dockerfile .

# 2. 运行容器
docker run -d \
  --name making-app \
  -p 3000:80 \
  --restart unless-stopped \
  flovart:latest

# 3. 访问应用
# 打开浏览器访�? http://localhost:3000
```

---

## ⚙️ 详细配置

### Docker Compose 配置说明

`docker-compose.yml` 文件包含以下主要配置�?

```yaml
version: '3.8'

services:
  making-app:
    build:
      context: .
      dockerfile: docker/Dockerfile
    
    container_name: making-app
    
    # 端口映射: 主机端口:容器端口
    ports:
      - "3000:80"
    
    # 环境变量
    environment:
      - NODE_ENV=production
    
    # 重启策略
    restart: unless-stopped
    
    # 健康检�?
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost/"]
      interval: 30s
      timeout: 3s
      retries: 3
    
    # 资源限制
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
```

### 自定义端�?

修改 `docker-compose.yml` 中的 `ports` 配置�?

```yaml
ports:
  - "8080:80"  # 修改为你想要的端�?
```

然后重新启动�?

```bash
docker-compose down
docker-compose up -d
```

### 配置环境变量

#### 方法 1：在 docker-compose.yml 中直接配�?

```yaml
environment:
  - VITE_GEMINI_API_KEY=your_api_key_here
  - VITE_ENABLE_AI=true
  - NODE_ENV=production
```

#### 方法 2：使�?.env 文件

1. 创建 `.env` 文件�?

```bash
cp env.example .env
```

2. 编辑 `.env` 文件�?

```env
VITE_GEMINI_API_KEY=your_actual_api_key
VITE_ENABLE_AI=true
NODE_ENV=production
```

3. �?`docker-compose.yml` 中引用：

```yaml
services:
  making-app:
    env_file:
      - .env
```

4. 重新构建�?

```bash
docker-compose up -d --build
```

> ⚠️ **重要**: 环境变量在构建时被编译进前端代码，需要重新构建镜像才能生效！

---

## 🏭 生产环境部署

### 1. 使用 Nginx 反向代理

创建 Nginx 配置文件 `/etc/nginx/sites-available/making`:

```nginx
server {
    listen 80;
    server_name making.yourdomain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

启用配置�?

```bash
sudo ln -s /etc/nginx/sites-available/making /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 2. 配置 HTTPS（使�?Let's Encrypt�?

#### 方法 A：使�?Certbot

```bash
# 安装 Certbot
sudo apt install certbot python3-certbot-nginx

# 获取证书并自动配�?
sudo certbot --nginx -d making.yourdomain.com

# 测试自动续期
sudo certbot renew --dry-run
```

#### 方法 B：使�?Caddy（推荐，自动 HTTPS�?

安装 Caddy�?

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

创建 Caddyfile�?

```
making.yourdomain.com {
    reverse_proxy localhost:3000
}
```

重启 Caddy�?

```bash
sudo systemctl reload caddy
```

### 3. 使用 Docker Compose + Traefik（自�?SSL�?

创建 `docker-compose.prod.yml`�?

```yaml
version: '3.8'

services:
  traefik:
    image: traefik:v2.10
    command:
      - "--api.insecure=true"
      - "--providers.docker=true"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.myresolver.acme.tlschallenge=true"
      - "--certificatesresolvers.myresolver.acme.email=your@email.com"
      - "--certificatesresolvers.myresolver.acme.storage=/letsencrypt/acme.json"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./letsencrypt:/letsencrypt
    networks:
      - making-network

  making-app:
    build: .
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.making.rule=Host(`making.yourdomain.com`)"
      - "traefik.http.routers.making.entrypoints=websecure"
      - "traefik.http.routers.making.tls.certresolver=myresolver"
    networks:
      - making-network

networks:
  making-network:
    driver: bridge
```

启动�?

```bash
docker-compose -f docker-compose.prod.yml up -d
```

### 4. 资源监控

#### 查看容器资源使用

```bash
# 实时监控
docker stats making-app

# 查看详细信息
docker inspect making-app
```

#### 设置资源限制

�?`docker-compose.yml` 中：

```yaml
deploy:
  resources:
    limits:
      cpus: '2.0'      # 最多使�?2 �?CPU 核心
      memory: 1G       # 最多使�?1GB 内存
    reservations:
      cpus: '0.5'      # 预留 0.5 �?CPU 核心
      memory: 256M     # 预留 256MB 内存
```

### 5. 日志管理

#### 配置日志轮转

�?`docker-compose.yml` 中：

```yaml
logging:
  driver: "json-file"
  options:
    max-size: "10m"    # 单个日志文件最�?10MB
    max-file: "3"      # 保留最�?3 个日志文�?
```

#### 查看日志

```bash
# 查看实时日志
docker-compose logs -f making-app

# 查看最�?100 行日�?
docker-compose logs --tail=100 making-app

# 查看某个时间段的日志
docker-compose logs --since 2024-01-01T10:00:00 making-app
```

### 6. 备份策略

#### 备份容器数据

```bash
# 导出容器（包含数据）
docker export making-app > making-app-backup.tar

# 导入容器
docker import making-app-backup.tar flovart:backup
```

#### 备份镜像

```bash
# 保存镜像
docker save flovart:latest > making-image.tar

# 加载镜像
docker load < making-image.tar
```

---

## 🔧 Docker 命令速查

### 容器管理

```bash
# 启动容器
docker-compose up -d

# 停止容器
docker-compose down

# 重启容器
docker-compose restart

# 查看运行中的容器
docker ps

# 查看所有容器（包括停止的）
docker ps -a

# 进入容器
docker exec -it making-app sh

# 查看容器日志
docker logs -f making-app
```

### 镜像管理

```bash
# 构建镜像
docker build -t flovart:latest .

# 查看镜像列表
docker images

# 删除镜像
docker rmi flovart:latest

# 清理未使用的镜像
docker image prune -a

# 查看镜像详情
docker inspect flovart:latest
```

### 资源清理

```bash
# 清理停止的容�?
docker container prune

# 清理未使用的镜像
docker image prune

# 清理未使用的�?
docker volume prune

# 清理所有未使用的资�?
docker system prune -a

# 查看磁盘使用情况
docker system df
```

---

## �?常见问题

### Q1: 如何修改容器端口�?

**A**: 编辑 `docker-compose.yml` 文件中的 `ports` 配置，然后重启：

```bash
docker-compose down
docker-compose up -d
```

### Q2: 如何更新应用到最新版本？

**A**: 

```bash
# 拉取最新代�?
git pull

# 重新构建并启�?
docker-compose up -d --build
```

### Q3: 容器启动失败怎么办？

**A**: 

```bash
# 查看详细日志
docker-compose logs making-app

# 检查容器状�?
docker inspect making-app

# 查看健康检查状�?
docker inspect making-app | grep -A 10 Health
```

### Q4: 如何�?Docker 中配�?API Key�?

**A**: 

1. 创建 `.env` 文件
2. 添加 `VITE_GEMINI_API_KEY=your_key`
3. 重新构建: `docker-compose up -d --build`

### Q5: 容器占用太多内存怎么办？

**A**: �?`docker-compose.yml` 中设置资源限制：

```yaml
deploy:
  resources:
    limits:
      memory: 512M
```

---

## 🐛 故障排查

### 容器无法启动

```bash
# 1. 检查端口是否被占用
sudo netstat -tulpn | grep :3000

# 2. 检�?Docker 服务状�?
sudo systemctl status docker

# 3. 查看详细错误日志
docker-compose logs making-app

# 4. 尝试重新构建
docker-compose build --no-cache
docker-compose up -d
```

### 应用访问不了

```bash
# 1. 检查容器是否运�?
docker ps | grep making-app

# 2. 检查容器健康状�?
docker inspect making-app | grep -A 5 Health

# 3. 测试容器内部访问
docker exec making-app curl -f http://localhost/

# 4. 检查防火墙
sudo ufw status
sudo ufw allow 3000
```

### 构建失败

```bash
# 1. 清理 Docker 缓存
docker system prune -a

# 2. 使用无缓存构�?
docker-compose build --no-cache

# 3. 检�?Docker 磁盘空间
docker system df

# 4. 清理磁盘空间
docker system prune -a --volumes
```

### 性能问题

```bash
# 1. 查看资源使用
docker stats making-app

# 2. 增加资源限制
# 编辑 docker-compose.yml，增�?memory �?cpus 限制

# 3. 优化 Nginx 配置
# 编辑 docker/nginx.conf，启�?gzip 压缩
```

---

## 📚 进阶主题

### 多环境部�?

创建不同环境的配置文件：

```bash
# 开发环�?
docker-compose -f docker-compose.yml up -d

# 生产环境
docker-compose -f docker-compose.prod.yml up -d

# 测试环境
docker-compose -f docker-compose.test.yml up -d
```

### Docker Swarm 集群部署

```bash
# 初始�?Swarm
docker swarm init

# 部署 Stack
docker stack deploy -c docker-compose.yml making-stack

# 查看服务
docker service ls

# 扩展服务
docker service scale making-stack_making-app=3
```

### CI/CD 集成

#### GitHub Actions 示例

```yaml
name: Docker Build and Push

on:
  push:
    branches: [ main ]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Build Docker image
        run: docker build -t flovart:latest .
      
      - name: Push to Docker Hub
        run: |
          echo "${{ secrets.DOCKER_PASSWORD }}" | docker login -u "${{ secrets.DOCKER_USERNAME }}" --password-stdin
          docker tag flovart:latest username/flovart:latest
          docker push username/flovart:latest
```

---

## 📞 获取帮助

如果你在 Docker 部署过程中遇到问题：

1. 查看 [Issues](../../issues) 中是否有类似问题
2. 创建新的 [Issue](../../issues/new) 详细描述你的问题
3. 加入我们的社区讨�?

---

<div align="center">

**祝你部署顺利！�?*

[返回主文档](README.md) · [报告问题](../../issues)

</div>


