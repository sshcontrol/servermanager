# ---------- Stage 1: build ----------
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .
RUN npm run build

# ---------- Stage 2: serve with nginx ----------
FROM nginx:stable-alpine

# Copy built assets to nginx html root
COPY --from=build /app/dist /usr/share/nginx/html

# Nginx config: serve SPA (fallback to index.html) and proxy /api to backend
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
