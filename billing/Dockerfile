FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --chown=node:node . .
USER node
EXPOSE 3000
CMD ["node","src/server.js"]
