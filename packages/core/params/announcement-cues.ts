// 行動を変える一般的な放送と発表の手がかり。言い回しの照合規則だけを持ち、実際の発表文は写さない
// 出典: 開発者の推定。一般に聞かれる言い回しの目安
// 降車、運転整理、点検、駅へ進む扱いの言い回しは docs/research/rail-operations/ の 02、04、06 を根拠にする

// 手がかりの id の定義は packages/schema が唯一の正
import type { AnnouncementCueId } from "@repo/schema";

export { ANNOUNCEMENT_CUE_IDS, type AnnouncementCueId } from "@repo/schema";

// 条件付きの文に含まれる語。この語を含む文では、再開に向けた手がかりを数えない
export const CONDITIONAL_SENTENCE_MARKERS: readonly string[] = ["次第"];

// 条件付きの文では数えない手がかり
export const CONDITIONAL_SENSITIVE_CUES: ReadonlySet<AnnouncementCueId> = new Set([
  "resumed",
  "resume_soon",
  "track_cleared",
]);

// 文を節に分ける区切り。否定は、手がかりの言い回しと同じ節の中だけに効かせる
export const CLAUSE_SEPARATORS: RegExp =
  /が、|けれど(?:も)?、?|けど、?|ので、?|ものの、?|しかし、?|\bbut\b|\bso\b/;

// 否定の言い回し。この言い回しを含む節では、再開や受信などの手がかりを数えない
// 「異常はありません」は確かめた文なので否定に数えない。「申し訳ありません」はお詫びなので数えない
export const NEGATION_PATTERNS: readonly RegExp[] = [
  /(?<!異常(?:は|が)?|申し訳)ありません/,
  /て(?:は)?いません/,
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
  "queue_ahead",
  "evacuation_on_track",
  "turnback",
  "service_cancelled",
  "through_service_suspended",
  "slow_running",
  "held_at_station",
  "inspection_ongoing",
  "proceed_to_station",
]);

// 止める文の言い回し。「線路に降りないでください」のような文では、降車の手がかりを数えない
export const PROHIBITION_PATTERNS: readonly RegExp[] = [
  /ないで(?:ください|下さい|お待ち)/,
  /ないよう(?:に)?(?:して|お願い|ご注意)/,
  /(?:おやめ|お控え)(?:ください|下さい)/,
  /危険です/,
  /\b(?:do not|don't|never)\b/i,
];

// 止める文では数えない手がかり
export const PROHIBITION_SENSITIVE_CUES: ReadonlySet<AnnouncementCueId> = new Set([
  "evacuation_on_track",
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
    /安全(?:が|を)?確認(?:でき|され|が取れ)(?:まし)?た(?!区間)/,
    /確認(?:が)?(?:でき|取れ|終わり|終了し)(?:まし)?た(?!区間)/,
    // 点検の終わりを告げる文。点検中の状態を解く
    /(?:点検|安全確認)(?:作業)?(?:は|が)?(?:終了し|終わり|完了し|済み)(?:まし)?た/,
    /異常(?:は|が)?(?:なし|無し|ありません|ない|無い)/,
    /resum\w* shortly|safety (?:has been |was )?confirmed|no abnormalit/i,
  ],
  // 線路に降りて歩く案内。降り始めると再開の見込みが立たない
  evacuation_on_track: [
    /線路(?:に|へ|上に)(?:お?降り|下り|おり)/,
    /線路(?:上)?を(?:歩|徒歩)/,
    /(?:最寄り|次)の?駅まで(?:歩|徒歩)/,
    /降車(?:誘導|のご案内|をご案内|していただ)/,
    /はしご(?:で|を使って|を使い、?|を使用して)[^。]*?(?:降り|下り|おり)/,
    /(?:walk|evacuat\w*) (?:along|on|onto) the tracks?|step down (?:onto|to) the tracks?/i,
  ],
  // 走れる区間だけで列車を往復させる
  turnback: [/折り?返し(?:運転|運行)/, /(?:駅|間)で折り?返し/, /turn(?:ing)? back|turnback/i],
  // 途中の駅で運行をやめる
  service_cancelled: [
    /運転を?(?:取り?やめ|打ち?切)/,
    /(?:この|当)(?:列車|電車)は(?:ここで|当駅で|この駅で)?(?:運転|運行)を?(?:終了|終わり)/,
    /terminat\w* (?:here|at)|service (?:is |has been )?cancel+ed/i,
  ],
  // 他社線への直通をやめ、事業者ごとに折り返す
  through_service_suspended: [
    /直通(?:運転|運行)?(?:を|は)?(?:中止|取り?やめ|見合わせ|休止)/,
    /through (?:service|operation)s? (?:is |are |has been |have been )?(?:suspended|cancel+ed|halted)/i,
  ],
  slow_running: [
    /徐行(?:運転|して|しながら|で|いたし|します|しております|中)/,
    /(?:running|operating) (?:at )?(?:reduced|slow) speed|slow(?:ly)? running/i,
  ],
  // 不通区間へ向かう列車を手前の駅で止めておく。駅間の「しばらく停車」は数えない
  held_at_station: [
    /(?:この|当)駅で(?:しばらく)?(?:停車|発車を見合わせ|待機|運転を見合わせ)/,
    /(?:この|当)駅に(?:しばらく)?(?:停車|止まり)/,
    /抑止/,
    /held (?:at|in) (?:this|the) station/i,
  ],
  // 点検や安全確認が続いている。終わったと言う文は数えない
  inspection_ongoing: [
    /(?:点検|安全確認|設備の確認|線路の確認)(?:中|を(?:行って|実施して|して)(?:い|お))/,
    /(?:点検|安全確認)(?:作業)?を(?:行い|実施し)(?:ます|ております|ています)/,
    /(?:inspection|safety check)s? (?:is |are )?(?:under ?way|in progress|ongoing)|(?:inspecting|checking) the (?:track|line)s?/i,
  ],
  // 安全を確かめた区間を、次の駅まで進む
  proceed_to_station: [
    /安全(?:を|が)?確認(?:した|された|できた|の取れた|が取れた)区間/,
    /(?:最寄り|次)の?駅まで(?:徐行|ゆっくり|低速|運転|進|移動|走)/,
    /proceed\w* (?:slowly )?to the (?:next|nearest) station/i,
  ],
};
