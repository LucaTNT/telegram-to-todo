FROM node:19-alpine
COPY package.json package-lock.json /app/
WORKDIR /app
RUN npm i --only=prod
COPY index.js telegram_tools.js todo_tools.js /app/
USER node
CMD ["node", "/app/index.js"]
