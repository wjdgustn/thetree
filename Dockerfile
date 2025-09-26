ARG NODE_VERSION=22.19.0

FROM node:${NODE_VERSION}-alpine AS builder

#USER node
WORKDIR /usr/src/app

RUN --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=package-lock.json,target=package-lock.json \
    --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

FROM node:${NODE_VERSION}-alpine

ARG GIT_BRANCH=master
ARG GIT_COMMIT_ID=null
ARG GIT_COMMIT_DATE=0

ENV NODE_ENV production
ENV IS_DOCKER true
ENV GIT_COMMIT_ID ${GIT_COMMIT_ID}
ENV GIT_BRANCH ${GIT_BRANCH}
ENV GIT_COMMIT_DATE ${GIT_COMMIT_DATE}

ENV ILA_DATA_DIR /usr/src/app/cache/geoip-db

RUN apk add --no-cache git

#USER node
WORKDIR /usr/src/app

COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY . .

RUN chown -R node:node /usr/src/app
USER node

RUN git config --global --add safe.directory /usr/src/app/*

EXPOSE 3000
CMD node main.js