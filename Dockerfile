FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install

FROM deps AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*
COPY . .
RUN git rev-parse HEAD > /tmp/chucklarr-build-ref || printf 'local' > /tmp/chucklarr-build-ref
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ARG CHUCKLARR_BUILD_REF=local
ENV CHUCKLARR_BUILD_REF=${CHUCKLARR_BUILD_REF}
ENV CHUCKLARR_ALLOW_AUTO_UPDATE=true
ENV CHUCKLARR_UPDATE_REPOSITORY=mscodemonkey/Chucklarr
ENV CHUCKLARR_UPDATE_BRANCH=main
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /tmp/chucklarr-build-ref ./build-ref
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data
EXPOSE 3333
CMD ["node", "dist/server/index.js"]
