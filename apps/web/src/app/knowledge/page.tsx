import { getTranslations } from "next-intl/server";
import { loadKnowledgeDocuments } from "@/features/knowledge/load-documents";
import { loadReplayScenarios } from "@/features/replay/load-scenarios";
import { KnowledgeScreen } from "@/screens/KnowledgeScreen";

export async function generateMetadata() {
  const t = await getTranslations("knowledge");
  return { title: t("title") };
}

export default function KnowledgePage() {
  const documents = loadKnowledgeDocuments();
  // 知見ごとに、その事象を扱うリプレイのシナリオへ戻れるようにする
  const scenarios = loadReplayScenarios().map((s) => ({
    id: s.id,
    title: s.title,
    eventType: s.event_type,
  }));
  return <KnowledgeScreen documents={documents} scenarios={scenarios} />;
}
