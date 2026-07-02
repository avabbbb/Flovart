.PHONY: help build up down restart logs shell clean rebuild status stats web backend db

COMPOSE ?= docker compose

help:
	@echo "Flovart Docker 管理命令"
	@echo ""
	@echo "使用方法: make [命令]"
	@echo ""
	@echo "可用命令:"
	@echo "  make build       - 构建 Docker 镜像"
	@echo "  make up          - 启动全部容器（后台运行）"
	@echo "  make web         - 启动 Web 及依赖服务"
	@echo "  make backend     - 启动 Hub + Enterprise + 数据库"
	@echo "  make db          - 只启动 PostgreSQL"
	@echo "  make down        - 停止并删除容器"
	@echo "  make restart     - 重启容器"
	@echo "  make logs        - 查看实时日志"
	@echo "  make shell       - 进入 Web 容器 Shell"
	@echo "  make clean       - 清理容器、卷和悬空镜像"
	@echo "  make rebuild     - 无缓存重建并启动"
	@echo "  make status      - 查看容器状态"
	@echo "  make stats       - 查看资源使用情况"
	@echo ""

build:
	@echo "正在构建 Docker 镜像..."
	$(COMPOSE) build

up:
	@echo "正在启动全部容器..."
	$(COMPOSE) up -d --build
	@echo "容器已启动：Web http://localhost:11451"

web:
	@echo "正在启动 Web 及依赖服务..."
	$(COMPOSE) up -d --build web
	@echo "Web: http://localhost:11451"

backend:
	@echo "正在启动后端与数据库..."
	$(COMPOSE) up -d --build db hub enterprise

db:
	@echo "正在启动 PostgreSQL..."
	$(COMPOSE) up -d db

down:
	@echo "正在停止容器..."
	$(COMPOSE) down

restart:
	@echo "正在重启容器..."
	$(COMPOSE) restart

logs:
	@echo "查看容器日志（按 Ctrl+C 退出）..."
	$(COMPOSE) logs -f

shell:
	@echo "进入 Web 容器 Shell..."
	$(COMPOSE) exec web sh

clean:
	@echo "正在清理 Docker 资源..."
	$(COMPOSE) down -v
	docker system prune -f
	@echo "清理完成！"

rebuild:
	@echo "正在无缓存重建..."
	$(COMPOSE) build --no-cache
	$(COMPOSE) up -d
	@echo "重新构建完成：Web http://localhost:11451"

status:
	@echo "容器状态:"
	$(COMPOSE) ps

stats:
	@echo "资源使用情况（按 Ctrl+C 退出）:"
	$(COMPOSE) stats