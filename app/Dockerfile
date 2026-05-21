FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY index.js ./
ARG APP_VERSION=dev
ARG FAIL_RATE=0
ENV APP_VERSION=${APP_VERSION}
ENV FAIL_RATE=${FAIL_RATE}
EXPOSE 3000
USER node
CMD ["node", "index.js"]
