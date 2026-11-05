"use client";

import { StatusScreen } from "@/components/StatusScreen";

// 画面の描画で思わぬエラーが起きたとき。もう一度試すか、地図から始め直す
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return <StatusScreen kind="error" onRetry={reset} />;
}
