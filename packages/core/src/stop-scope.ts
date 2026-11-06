// 止まり方の区別。その列車だけが止まるものと、区間を止めるもの
// 知見のスキーマは止まり方を持たないので、事象の id で 1 か所にまとめる。web と agent が同じ表を引く

export type StopScope = "train" | "section";

// その列車だけが止まる事象。車内の急病人や非常ボタンのように、区間全体の運転見合わせにはならない
const TRAIN_ONLY_EVENT_TYPES: ReadonlySet<string> = new Set(["in_car_response"]);

// 事象の id から止まり方を引く。分からなければ区間を止めるものとみなす
export function resolveStopScope(eventType: string | null | undefined): StopScope {
  return eventType && TRAIN_ONLY_EVENT_TYPES.has(eventType) ? "train" : "section";
}
