"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// 状況の入力は入口の地図の上のシートに移した。古い URL は入口へ送る
// 入口は選んだ駅・路線・行き先が残っていれば、入力の方法を選ぶ段から再開する
export function SituationScreen() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/");
  }, [router]);
  return null;
}
