import type { TicketType } from "@repo/schema";

// 振替輸送の対象かを乗車券の種類で決める規則表
// 出典: docs/research/rail-operations/05-transfer-transport.md の関西の共通の扱いと、京阪電鉄の対象の乗車券の案内

// 関西の共通の扱いを取り入れた事業者のうち、調べの出典で名前を確かめたもの。packages/core の事業者キーで持つ
// 表に無い事業者は扱いが分からないものとして、費用を決めない
export const KANSAI_COMMON_TRANSFER_OPERATORS: readonly string[] = [
  "jr-west",
  "hankyu",
  "hanshin",
  "keihan",
  "kintetsu",
  "nankai",
  "osaka-metro",
  "kyoto-subway",
  "shintetsu",
];

// 振替輸送の対象か。改札に入った後の IC の残額は対象外。定期券は磁気と IC の両方が対象。紙の切符は対象
export const TICKET_TRANSFER_ELIGIBLE: Readonly<Record<TicketType, boolean>> = {
  ic: false,
  commuter_pass: true,
  paper: true,
};

export const TRANSFER_FARE_SOURCES: readonly { title: string; url: string }[] = [
  {
    title: "鉄道チャンネル「関西の鉄道 18 社局 振替輸送の利用方法を変更」2019 年 1 月",
    url: "https://tetsudo-ch.com/4184565.html",
  },
  {
    title: "京阪電鉄「振替輸送について」",
    url: "https://www.keihan.co.jp/traffic/ticket/transfer.html",
  },
  {
    title: "京都市交通局「京都市高速鉄道振替輸送取扱規程の一部を改正する規程」2019 年 3 月 15 日",
    url: "https://www2.city.kyoto.lg.jp/somu/bunsyo/kouhou/h3103/0315/0315_21.pdf",
  },
  {
    title: "神戸電鉄 ニュースリリース 2019 年 1 月 18 日",
    url: "https://www.shintetsu.co.jp/release/2018/190118.pdf",
  },
];
