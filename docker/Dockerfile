# ================================
# 多阶段构建 Dockerfile
# ================================

# -------------------- 阶段 1: 构建阶段 --------------------
FROM node:18-alpine AS builder

# 设置工作目录
WORKDIR /app

# 设置npm镜像（可选，加速国内构建）
# RUN npm config set registry https://registry.npmmirror.com

# 复制package文件
COPY package*.json ./

# 安装依赖
RUN npm ci --silent && \
    npm cache clean --force

# 复制项目文件
COPY . .

# 构建生产版本
RUN npm run build

# -------------------- 阶段 2: 运行阶段 --------------------
FROM nginx:1.25-alpine

# 安装基础工具（可选）
RUN apk add --no-cache curl

# 复制自定义nginx配置
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# 从构建阶段复制构建产物
COPY --from=builder /app/dist /usr/share/nginx/html

# 创建健康检查脚本
RUN echo '#!/bin/sh' > /healthcheck.sh && \
    echo 'curl -f http://localhost/ || exit 1' >> /healthcheck.sh && \
    chmod +x /healthcheck.sh

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD /healthcheck.sh

# 暴露端口
EXPOSE 80

# 启动nginx
CMD ["nginx", "-g", "daemon off;"]

# ================================
# 元数据标签
# ================================
LABEL maintainer="Making Project"
LABEL description="Making - 类Lovart的画布白板工具"
LABEL version="1.0.0"
