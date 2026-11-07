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

// 否定の文の言い回し。この言い回しを含む文では、再開と受信の手がかりを数えない
// 「異常はありません」は確かめた文なので否定に数えない
export const NEGATION_PATTERNS: readonly RegExp[] = [
  /(?<!異常(?:は|が)?)ありません/,
  /ていません/,
  /ておりません/,
  /できません/,
  /未定/,
  /見込み(?:は|が)(?:ない|無い|立た|たた)/,
  /(?:めど|目処|目途)(?:は|が)(?:ない|無い|立た|たた)/,
  /\bnot\b|n't\b|\bno (?:estimate|resum|signal)/i,
];

// 否定の文では数えない手がかり
export const NEGATION_SENSITIVE_CUES: ReadonlySet<AnnouncementCueId> = new Set([
  "resumed",
  "resume_soon",
  "track_cleared",
  "protection_received",
]);

export const ANNOUNCEMENT_CUE_PATTERNS: Readonly<Record<AnnouncementCueId, readonly RegExp[]>> = {
  resumed: [
    /運転を?再開(?:しました|いたしました|しております)/,
    /運転再開(?:しました|いたしました)/,
    /(?:service|operation)s? (?:has|have) resumed|resumed (?:service|operation)/i,
  ],
  resume_soon: [/まもなく(?:運転を)?再開/, /順次(?:運転を)?再開/, /resum\w* shortly/i],
  rescue: [/救援/, /rescue/i],
  // 受信して止まったと言う文だけを数える
  protection_received: [
    /信号を受信(?:した|し、|して|しまし|いたし|したため|のため)/,
    /緊急停止信号(?:を受信|の受信|により|で停)/,
    /(?:received|receiving) (?:an |the )?emergency (?:stop )?signal/i,
  ],
  queue_ahead: [
    /前の(?:列車|電車)が(?:つかえ|詰まっ)/,
    /先行(?:列車|電車)(?:の影響|がつかえ|が詰まっ)/,
    /(?:train|trains) ahead/i,
  ],
  // 再開が近いと言い切る文と、確かめが済んだと言う文
  track_cleared: [
    /まもなく(?:運転を)?再開/,
    /順次(?:運転を)?再開/,
    /運転再開の準備/,
    /安全(?:が|を)?確認(?:でき|され|が取れ)(?:まし)?た/,
    /確認(?:が)?(?:でき|取れ|終わり|終了し)(?:まし)?た/,
    /異常(?:は|が)?(?:なし|無し|ありません|ない|無い)/,
    /resum\w* shortly|safety (?:has been |was )?confirmed|no abnormalit/i,
  ],
};
