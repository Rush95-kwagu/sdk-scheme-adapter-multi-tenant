FROM node:20-alpine
WORKDIR /app
COPY mock-als.js .
CMD ["node", "mock-als.js"]
