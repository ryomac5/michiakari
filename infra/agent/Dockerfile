# 判断エージェント（apps/agent）のコンテナ
# ビルド: リポジトリのルートで docker build -f infra/agent/Dockerfile -t kansai-agent .
# Node 24 の型の除去で TypeScript をそのまま動かす。ビルド済みの JS は作らない

ARG NODE_VERSION=24

# 依存の導入。エージェントと、その依存のワークスペースだけを本番依存で入れる
FROM node:${NODE_VERSION}-slim AS deps
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable pnpm
WORKDIR /app
# ロックファイルと全ワークスペースの package.json。ソースより先に置いて層を再利用する
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/agent/package.json apps/agent/
COPY apps/web/package.json apps/web/
COPY packages/schema/package.json packages/schema/
COPY packages/core/package.json packages/core/
COPY packages/geo/package.json packages/geo/
COPY packages/data/package.json packages/data/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile --prod --filter "@repo/agent..."

# 実行。ワークスペースの配置を保ち、findRepoRoot が /app/pnpm-workspace.yaml を見つけられるようにする
FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production \
    PORT=8787
WORKDIR /app
COPY --from=deps /app ./
COPY apps/agent/src apps/agent/src
COPY packages/schema/src packages/schema/src
COPY packages/core/src packages/core/src
COPY packages/core/params packages/core/params
COPY packages/geo/src packages/geo/src
COPY packages/geo/data packages/geo/data
# シナリオ。CONTENT_DIR が無ければ /app 直下を読む
COPY scenarios scenarios
# 公開版のリプレイに使う架空のダミーシナリオ。CONTENT_DIR でこちらに切り替える
COPY packages/schema/test/fixtures/dev-content packages/schema/test/fixtures/dev-content

# ファイルは root の所有のまま読み取り専用で使い、非 root の node ユーザーで動かす
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/agent/src/server.ts"]
