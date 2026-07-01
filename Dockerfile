FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 3217
CMD ["npx", "vite", "--host", "0.0.0.0", "--port", "3217"]
