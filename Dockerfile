# Whot realtime server. Same engine the browser runs, now in a container.
FROM node:24-alpine

WORKDIR /app

# Dependencies first so the layer caches across code changes.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Only the game surface and the server: tests and docs stay out of the image.
COPY index.html style.css ./
COPY js ./js
COPY server ./server

# Render assigns a port through the PORT environment variable.
ENV PORT=3000
EXPOSE 3000

USER node
CMD ["node", "server/index.js"]
