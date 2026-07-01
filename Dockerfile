FROM node:20-alpine
COPY package.json package-lock.json /app/
WORKDIR /app
RUN npm ci --omit=dev
COPY index.js telegram_tools.js todo_tools.js /app/
USER node
CMD ["node", "/app/index.js"]
