FROM node:19-alpine
COPY . /app
WORKDIR /app
RUN npm i --only=prod
USER node
CMD ["node", "/app/index.js"]
