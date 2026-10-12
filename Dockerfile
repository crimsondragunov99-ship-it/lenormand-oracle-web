FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production AUTH_MODE=remote PORT=4175 DATA_DIR=/var/lib/lenormand
WORKDIR /app
COPY --from=build /app/node_modules/jose ./node_modules/jose
COPY server ./server
COPY --from=build /app/dist ./dist
RUN mkdir -p /var/lib/lenormand /shared-site && chown -R node:node /var/lib/lenormand /shared-site /app
USER node
EXPOSE 4175
CMD ["node", "server/chatgpt.mjs"]
