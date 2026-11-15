FROM node:24-alpine AS build
WORKDIR /srv
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM nginx:1.28-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /srv/dist /usr/share/nginx/html
EXPOSE 80
