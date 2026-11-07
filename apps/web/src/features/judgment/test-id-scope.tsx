"use client";

import { createContext, type ReactNode, useContext } from "react";

// 同じ部品を画面に 2 つ置くときの data-testid の頭。地図の上のグラフはシートの中のグラフと同じ部品を使う
// 頭が無ければ、data-testid をそのまま使う
const TestIdScopeContext = createContext<string | null>(null);

export function TestIdScope({ scope, children }: { scope: string; children: ReactNode }) {
  return <TestIdScopeContext.Provider value={scope}>{children}</TestIdScopeContext.Provider>;
}

export function useScopedTestId(): (id: string) => string {
  const scope = useContext(TestIdScopeContext);
  return (id) => (scope ? `${scope}-${id}` : id);
}
