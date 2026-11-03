// e2e の web サーバーで next/font/google が読む固定の応答。NEXT_FONT_GOOGLE_MOCKED_RESPONSES に渡す
// Google Fonts へ取りに行かず、端末のフォントと next が作る代わりのフォントで描く
// フォントのファイルを指すと next dev が取りに行くので、@font-face は書かない

const empty = "/* e2e: Google Fonts を取りに行かない */\n";

module.exports = {
  "https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap": empty,
  "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap": empty,
};
