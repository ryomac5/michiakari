#!/usr/bin/env bash
# 判断エージェントを Cloud Build でビルドし、Cloud Run に出す
# 使い方: リポジトリのルートで CORS_ORIGINS=https://xxx.vercel.app bash infra/deploy-agent.sh
# API キーは Secret Manager の anthropic-api-key から渡す。この台本はキーの値を扱わない
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-project-513d85ec-389b-42f9-b12}"
REGION="${REGION:-asia-northeast1}"
SERVICE="${SERVICE:-kansai-agent}"
REPOSITORY="${REPOSITORY:-kansai}"
SECRET_NAME="${SECRET_NAME:-anthropic-api-key}"
# 画面のオリジン。カンマ区切りで複数指定できる。出し直しで消えないよう毎回必ず渡す
CORS_ORIGINS="${CORS_ORIGINS:?CORS_ORIGINS に画面のオリジンを渡してください}"
# リプレイのシナリオの置き場所。/app からの相対。公開版は架空のダミーシナリオを読む
CONTENT_DIR="${CONTENT_DIR:-packages/schema/test/fixtures/dev-content}"
# 1 分あたりに 1 利用者へ許す /judge の回数
RATE_LIMIT_PER_MINUTE="${RATE_LIMIT_PER_MINUTE:-6}"
# 使いすぎを防ぐため台数を絞る。頻度制限はインスタンスごとに数える
MAX_INSTANCES="${MAX_INSTANCES:-2}"
MIN_INSTANCES="${MIN_INSTANCES:-0}"
# 1 インスタンスが同時に受ける判断の数。判断は Claude の応答待ちが主なので多めでよい
CONCURRENCY="${CONCURRENCY:-20}"
# SSE を切らないための要求の上限秒数。判断は通常 1 分前後で終わる
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-600}"

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

tag="$(git rev-parse --short HEAD)"
image="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/agent:${tag}"

# イメージの置き場所が無ければ作る
if ! gcloud artifacts repositories describe "$REPOSITORY" \
  --project "$PROJECT_ID" --location "$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPOSITORY" \
    --project "$PROJECT_ID" --location "$REGION" --repository-format docker
fi

gcloud builds submit . \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --config infra/cloudbuild.yaml \
  --substitutions "_IMAGE=${image}"

# CORS_ORIGINS にカンマが入るので、環境変数の区切りを @ にする
gcloud run deploy "$SERVICE" \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --image "$image" \
  --allow-unauthenticated \
  --port 8080 \
  --cpu 1 \
  --memory 512Mi \
  --cpu-boost \
  --concurrency "$CONCURRENCY" \
  --min-instances "$MIN_INSTANCES" \
  --max-instances "$MAX_INSTANCES" \
  --timeout "$TIMEOUT_SECONDS" \
  --set-env-vars "^@^JUDGE_MODE=claude@TRUST_PROXY=true@CORS_ORIGINS=${CORS_ORIGINS}@RATE_LIMIT_PER_MINUTE=${RATE_LIMIT_PER_MINUTE}@CONTENT_DIR=${CONTENT_DIR}" \
  --set-secrets "ANTHROPIC_API_KEY=${SECRET_NAME}:latest"

gcloud run services describe "$SERVICE" \
  --project "$PROJECT_ID" --region "$REGION" --format 'value(status.url)'
