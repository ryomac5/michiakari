// 行動を変える一般的な放送と発表の手がかり。言い回しの照合規則だけを持ち、実際の発表文は写さない
// 出典: 開発者の推定。一般に聞かれる言い回しの目安

export const ANNOUNCEMENT_CUE_IDS = [
  // 運転を再開した
  "resumed",
  // まもなく再開する、順次再開する
  "resume_soon",
  // 救援の列車や人が向かう
  "rescue",
  // 防護無線を受けて止まった
  "protection_received",
  // 前の列車がつかえて先へ進めない
  "queue_ahead",
  // 線路の安全が確かめられた
  "track_cleared",
] as const;
export type AnnouncementCueId = (typeof ANNOUNCEMENT_CUE_IDS)[number];

// 条件付きの文に含まれる語。この語を含む文では、再開に向けた手がかりを数えない
export const CONDITIONAL_SENTENCE_MARKERS: readonly string[] = ["次第"];

// 条件付きの文では数えない手がかり
export const CONDITIONAL_SENSITIVE_CUES: ReadonlySet<AnnouncementCueId> = new Set([
  "resumed",
  "resume_soon",
  "track_cleared",
]);

export const ANNOUNCEMENT_CUE_PATTERNS: Readonly<Record<AnnouncementCueId, readonly RegExp[]>> = {
  resumed: [
    /運転を?再開(?:しました|いたしました|しております)/,
    /運転再開(?:しました|いたしました)/,
    /(?:service|operation)s? (?:has|have) resumed|resumed (?:service|operation)/i,
  ],
  resume_soon: [/まもなく(?:運転を)?再開/, /順次(?:運転を)?再開/, /resum\w* shortly/i],
  rescue: [/救援/, /rescue/i],
  protection_received: [
    /(?:危険を知らせる|緊急停止の?)信号を受信/,
    /緊急停止信号/,
    /信号を受信(?:した|いたし|しま)/,
    /emergency (?:stop )?signal/i,
  ],
  queue_ahead: [
    /前の(?:列車|電車)が(?:つかえ|詰まっ)/,
    /先行(?:列車|電車)(?:の影響|がつかえ|が詰まっ)/,
    /(?:train|trains) ahead/i,
  ],
  track_cleared: [
    /まもなく(?:運転を)?再開/,
    /順次(?:運転を)?再開/,
    /運転再開の準備/,
    /安全(?:が|を)確認(?:でき|され)まし/,
    /resum\w* shortly|safety (?:has been |was )?confirmed/i,
  ],
};
