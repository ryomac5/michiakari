# 文言の監査

`docs/agents/wording.md` の決まり R1 から R11 に照らし、いまの文言で合わない箇所を洗い出した。コードは変えていない。対象は判断の見出し、理由、境目の文、画面の文言、エージェントが利用者に返すエラー文と根拠文である。

ファイル名は短く書く。場所の対応は次のとおりとする。

- `ja.json`: `apps/web/messages/ja.json`
- `en.json`: `apps/web/messages/en.json`
- `templates.ts`: `apps/agent/src/judge/templates.ts`
- `typical-flow.ts`: `apps/agent/src/domain/typical-flow.ts`
- `judgment-system.md`: `apps/agent/src/prompts/judgment-system.md`
- `person-accident.ts`: `apps/web/src/features/judgment/fixtures/person-accident.ts`
- `signal-text.ts`: `apps/web/src/features/judgment/signal-text.ts`
- `session.ts`: `apps/agent/src/judge/session.ts`
- `geo-provider.ts`: `apps/agent/src/alternatives/geo-provider.ts`
- `app.ts`: `apps/agent/src/app.ts`
- `run-judge.ts`: `apps/agent/src/judge/run-judge.ts`

行番号は 2026-11-06 時点の develop のものである。{time}、{minutes} などの波括弧は、実行時に値が入る場所である。省略記号「…」は、文の同じ部分を略したことを示す。

## 決まりに合わない箇所

| ファイル:行 | いまの文 | 決まり | 直した文の案 |
|---|---|---|---|
| `ja.json:4` | `運転見合わせで待つか乗り換えるかを決める。元指令員の知見から見込みと行動を示す。` | R2 | `運転見合わせで待つか乗り換えるかを決められます。元指令員の知見から見込みと行動を示します。` |
| `ja.json:27` | `運行情報は何が起きたかまでしか伝えない。` | R2 | `運行情報は、何が起きたかまでしか伝えません。` |
| `ja.json:28` | `元指令員の知見から次の一手を選ぶ。` | R2 | `元指令員の知見から、次の一手を選べます。` |
| `ja.json:31` | `現在地を取得しています…` | R7 | `現在地を取得しています` |
| `ja.json:32` | `駅名で探す。現在地はあとで試し直せる。` | R2 | `現在地を取れませんでした。駅名で探してください。` |
| `ja.json:33` | `この端末では駅名で探す。` | R2 | `この端末では現在地を使えません。駅名で探してください。` |
| `ja.json:36` | `別の書き方で探す` | R2 | `見つかりませんでした。別の書き方で探してください。` |
| `ja.json:38` | `駅名で探す。最寄り駅はあとで試し直せる。` | R2 | `最寄り駅を取れませんでした。駅名で探してください。` |
| `ja.json:39` | `現在地は最寄り駅の検索だけに送る。位置は保存しない。` | R2 | `現在地は最寄り駅の検索だけに送ります。位置は保存しません。` |
| `ja.json:41` | `通信を確かめる。もう一度探す。` | R2 | `通信を確かめて、もう一度探してください。` |
| `ja.json:45` | `掲示や発表からいまの段階を読み取る。` | R2 | `掲示や発表から、いまの段階を読み取ります。` |
| `ja.json:53` | `駅の掲示や案内画面を撮る。` | R2 | `駅の掲示や案内画面を撮ってください。` |
| `ja.json:57` | `別の写真を選ぶ。掲示の文字を大きく写す。` | R2 | `別の写真を選んでください。掲示の文字を大きく写してください。` |
| `ja.json:68` | `選択肢は準備中。撮影か貼り付けで伝える。` | R2 | `選択肢は準備中です。撮影か貼り付けで伝えてください。` |
| `ja.json:69` | `事象を選び直す` | R3 | `起きていることを選び直す` |
| `ja.json:72` | `判断しています…` | R7 | `判断しています` |
| `ja.json:84` | `代替手段を調べる` | R9 | `代わりの手段を調べる` |
| `ja.json:117` | `おすすめ: {label}・{time} 着` | R6 | `おすすめ: {label}・{time}着` |
| `ja.json:118` | `再開まで 約{p50}〜{p80}分` | R6 | `再開まで約{p50}〜{p80}分` |
| `ja.json:121` | `{time} 着` | R6 | `{time}着` |
| `ja.json:132` | `通信を確かめる。もう一度判断する。` | R2 | `通信を確かめて、もう一度判断してください。` |
| `ja.json:133` | `時間をおく。もう一度判断する。` | R2 | `少し待ってから、もう一度判断してください。` |
| `ja.json:141` | `まもなく境目です。乗り換えに備える` | R2 | `まもなく境目です。乗り換えに備えてください。` |
| `ja.json:143` | `到着時刻を比べられる代わりの経路はない。運転再開を待つ。` | R2 | `到着時刻を比べられる代わりの経路はありません。運転再開を待ってください。` |
| `ja.json:144` | `計算しています…` | R7 | `計算しています` |
| `ja.json:146` | `あと {minutes} 分` | R6 | `あと{minutes}分` |
| `ja.json:147` | `あと {hours} 時間 {minutes} 分` | R6 | `あと{hours}時間{minutes}分` |
| `ja.json:149` | `<clock>{time}</clock> までに再開すれば待つほうが早く着く` | R2, R5, R6 | `<clock>{time}</clock>までに再開すれば、待つほうが早く着きます。{time} は「21時40分」で渡す` |
| `ja.json:155` | `再開見込み {from}〜{to} は境目 {breakEven} より前。待つほうが早く着く見込み。` | R2, R5 | `再開見込みは{from}〜{to}で、境目の{breakEven}より前です。待つほうが早く着く見込みです。` |
| `ja.json:156` | `再開見込み {from}〜{to} は境目 {breakEven} をまたぐ。見込みが延びたら切り替える。` | R2, R5 | `再開見込みは{from}〜{to}で、境目の{breakEven}をまたぎます。見込みが延びたら切り替えてください。` |
| `ja.json:157` | `再開見込み {from}〜{to} は境目 {breakEven} より後。切り替えるほうが早く着く見込み。` | R2, R5 | `再開見込みは{from}〜{to}で、境目の{breakEven}より後です。切り替えるほうが早く着く見込みです。` |
| `ja.json:195` | `{station}まで徒歩 {minutes} 分` | R6 | `{station}まで徒歩{minutes}分` |
| `ja.json:198` | `徒歩 {minutes} 分で向かう` | R6 | `徒歩{minutes}分で向かう` |
| `ja.json:199` | `{time} 着` | R6 | `{time}着` |
| `ja.json:213` | `警報・注意報は次の観測で確かめます` | R3 | `警報・注意報は次の更新で確かめます` |
| `ja.json:215` | `欠測` | R3 | `観測なし` |
| `ja.json:216` | `欠測 {count}件` | R3 | `{count}件は観測なし` |
| `ja.json:286` | `ふつう{duration}ほどで再開` | R4 | `多くの場合は約{duration}で再開` |
| `ja.json:287` | `ふつう{span}分で終わる` | R4 | `多くの場合は{span}分で終わる` |
| `ja.json:297` | `新しい掲示や発表を入れる。判断を更新する。` | R2 | `新しい掲示や発表を入れると、判断を更新します。` |
| `ja.json:306` | `行き先は{direction}方面の主な駅の{station}と仮定する` | R2 | `行き先は{direction}方面の主な駅の{station}と仮定しています。` |
| `ja.json:307` | `行き先は終点の{station}と仮定する` | R2 | `行き先は終点の{station}と仮定しています。` |
| `ja.json:308` | `車内の位置は{station}駅と仮定する` | R2 | `車内の位置は{station}駅と仮定しています。` |
| `ja.json:309` | `止まった時刻はいまと仮定する` | R2 | `止まった時刻はいまと仮定しています。` |
| `ja.json:310` | `原因は未確認。境目の時刻を動く目安にする` | R2 | `原因は未確認です。境目の時刻を動く目安にしています。` |
| `ja.json:311` | `原因は放送で聞いた{cause}と仮定する` | R2 | `原因は放送で聞いた{cause}と仮定しています。` |
| `ja.json:312` | `原因は放送で聞いた{cause}。傾向の無い原因なので境目の時刻を動く目安にする` | R2, R8 | `原因は放送で聞いた{cause}です。傾向のない原因なので、境目の時刻を動く目安にしています。` |
| `ja.json:313` | `駅と駅の間にいる。{station}に着いてからの行動を示す` | R2 | `駅と駅の間にいます。{station}に着いてからの行動を示します。` |
| `ja.json:331` | `前の列車はふだんの間隔と推定` | R4 | `前の列車は通常の間隔と推定` |
| `ja.json:339` | `最後の 1 つを消す` | R6 | `最後の1つを消す` |
| `ja.json:366` | `架空の運転見合わせを 1 つ選んでください。発表が届くたびに、判断と地図が変わる様子を再生します。` | R6 | `架空の運転見合わせを1つ選んでください。発表が届くたびに、判断と地図が変わる様子を再生します。` |
| `ja.json:404` | `段階は次の観測で絞り込めます` | R3 | `段階は次の発表で絞り込めます` |
| `ja.json:414` | `{time} に切り替え` | R6 | `{time}に切り替え` |
| `ja.json:422` | `判断に従うと、待ち続けた人より {minutes}分早く着き、{deadline} の期限に間に合いました。` | R5, R6, R8 | `判断に従うと、待ち続けた人より{minutes}分早く着きました。{deadline}の期限にも間に合いました。` |
| `ja.json:423` | `判断に従うと、待ち続けた人より {minutes}分早く着きました。` | R6 | `判断に従うと、待ち続けた人より{minutes}分早く着きました。` |
| `ja.json:424` | `今回は待ち続けたほうが {minutes}分早く着きました。` | R6 | `今回は待ち続けたほうが{minutes}分早く着きました。` |
| `ja.json:425` | `判断に従っても待ち続けても、着く時刻の差は {minutes}分でした。` | R6 | `判断に従っても待ち続けても、着く時刻の差は{minutes}分でした。` |
| `ja.json:426` | `待つ判断に従うと、{time} に切り替えた人より {minutes}分早く着きました。` | R5, R6 | `待つ判断に従うと、{time}に切り替えた人より{minutes}分早く着きました。{time} は「21時40分」で渡す` |
| `ja.json:427` | `今回は待つ判断が外れました。{time} に切り替えた人のほうが {minutes}分早く着きました。` | R5, R6 | `今回は待つ判断が外れました。{time}に切り替えた人のほうが{minutes}分早く着きました。` |
| `ja.json:428` | `待つ判断に従っても {time} に切り替えても、着く時刻の差は {minutes}分でした。` | R5, R6 | `待つ判断に従っても{time}に切り替えても、着く時刻の差は{minutes}分でした。` |
| `ja.json:432` | `どちらも {deadline} の期限に間に合いました。` | R5, R6 | `どちらも{deadline}の期限に間に合いました。{deadline} は「21時40分」で渡す` |
| `ja.json:433` | `判断に従った人だけが {deadline} の期限に間に合いました。` | R5, R6 | `判断に従った人だけが{deadline}の期限に間に合いました。` |
| `ja.json:434` | `待ち続けた人だけが {deadline} の期限に間に合いました。` | R5, R6 | `待ち続けた人だけが{deadline}の期限に間に合いました。` |
| `ja.json:435` | `切り替えた人だけが {deadline} の期限に間に合いました。` | R5, R6 | `切り替えた人だけが{deadline}の期限に間に合いました。` |
| `ja.json:436` | `どちらも {deadline} の期限に間に合いませんでした。` | R5, R6 | `どちらも{deadline}の期限に間に合いませんでした。` |
| `ja.json:437` | `{deadline} の期限に間に合いました。` | R5, R6 | `{deadline}の期限に間に合いました。` |
| `ja.json:438` | `{deadline} の期限には間に合いませんでした。` | R5, R6 | `{deadline}の期限には間に合いませんでした。` |
| `ja.json:454` | `徒歩 {minutes} 分` | R6 | `徒歩{minutes}分` |
| `ja.json:470` | `事故が起きると、現場は安全と復旧が先になり、案内は「何が起きたか」で止まりがちです。` | R8 | `事故が起きると、現場は安全と復旧を優先します。案内は「何が起きたか」で止まりがちです。` |
| `ja.json:482` | `到着時刻や境目の時刻などの数値はプログラムで計算し、AI はその結果を解釈して説明します。` | R8 | `到着時刻や境目の時刻などの数値は、プログラムで計算します。AI はその結果を解釈して説明します。` |
| `ja.json:513` | `現在地は端末内で近くの駅を探すために使う。位置は保存しない。` | R2 | `現在地は端末内で近くの駅を探すためだけに使います。位置は保存しません。` |
| `ja.json:516` | `近くの駅が見つからない。地図か検索で駅を選ぶ。` | R2 | `近くの駅が見つかりません。地図か検索で駅を選んでください。` |
| `ja.json:518` | `エリアを押す。地図を広げて近くの駅を選ぶ。` | R2 | `エリアを押すと、地図が広がります。近くの駅を選んでください。` |
| `ja.json:525` | `{area}の駅を地図か下の一覧から選ぶ` | R2 | `{area}の駅を地図か下の一覧から選んでください。` |
| `ja.json:526` | `どの電車に乗る予定でしたか` | R1 | `乗る予定だった電車を選ぶ` |
| `ja.json:528` | `最寄りは{station}。距離は約{distance}` | R2 | `最寄りは{station}です。距離は約{distance}です。` |
| `ja.json:551` | `電車が向かう方向を選ぶ` | R2 | `電車が向かう方向を選んでください。` |
| `ja.json:595` | `10分くらい` | R4 | `約10分` |
| `ja.json:612` | `駅と駅の間。次に着く駅を出発にする` | R2 | `駅と駅の間にいます。次に着く駅を出発にします。` |
| `ja.json:613` | `いまいる場所を選んでください` | R1 | `いまいる場所を選ぶ` |
| `ja.json:618` | `位置は端末の中で候補を出すだけに使い、送らない。` | R2, R8 | `位置は端末の中で候補を出すためだけに使います。外へは送りません。` |
| `ja.json:623` | `近い順に並べた。いまいる場所を選んでください` | R2 | `近い順に並べました。いまいる場所を選んでください。` |
| `ja.json:626` | `位置情報の利用が許可されていない。下から選んでください。` | R2 | `位置情報の利用が許可されていません。下から選んでください。` |
| `ja.json:627` | `現在地を取れなかった。下から選んでください。` | R2 | `現在地を取れませんでした。下から選んでください。` |
| `ja.json:628` | `この端末では現在地を取れない。下から選んでください。` | R2 | `この端末では現在地を取れません。下から選んでください。` |
| `ja.json:629` | `近くに駅も路線も見つからない。下から選んでください。` | R2 | `近くに駅も路線も見つかりません。下から選んでください。` |
| `ja.json:630` | `地下鉄の地下区間では取れないことが多い。` | R2 | `地下鉄の地下区間では、現在地を取れないことが多いです。` |
| `ja.json:631` | `乗っている路線を選んでください` | R1 | `乗っている路線を選ぶ` |
| `ja.json:633` | `いまいる駅の間を選んでください` | R1 | `いまいる駅の間を選ぶ` |
| `ja.json:644` | `この頁は移動したか、まだ無いようです` | R11 | `このページは移動したか、まだありません` |
| `ja.json:645` | `URL が変わったのかもしれません。地図から選び直してみてください。` | R4 | `URL が変わった可能性があります。地図から選び直してください。` |
| `en.json:4` | `Choose whether to wait or switch in Kansai. Use estimates from a former train dispatcher.` | R10 | `Shows whether to wait or switch during a suspension in Kansai, using estimates from a former dispatcher.` |
| `en.json:28` | `Use a former dispatcher’s estimates to decide.` | R10 | `A former dispatcher’s estimates help you decide.` |
| `en.json:29` | `Where are you?` | R10 | `Your station` |
| `en.json:31` | `Getting your location…` | R7 | `Getting your location` |
| `en.json:45` | `Use a sign or announcement to assess progress.` | R10 | `A sign or announcement shows how far the disruption has progressed.` |
| `en.json:72` | `Thinking…` | R7, R9 | `Deciding` |
| `en.json:118` | `Resumes in {p50}–{p80} min` | R6, R9 | `Restarts in about {p50}–{p80} min` |
| `en.json:141` | `The cutoff is close. Get ready to switch` | R10 | `The cutoff is close. Get ready to switch.` |
| `en.json:142` | `Wait for service to resume` | R9 | `Wait for service to restart` |
| `en.json:143` | `No alternative arrival to compare. Wait for service to resume.` | R9, R10 | `No alternative route has an arrival time to compare. Wait for service to restart.` |
| `en.json:144` | `Calculating…` | R7 | `Calculating` |
| `en.json:152` | `Decision {time}` | R9 | `Cutoff {time}` |
| `en.json:160` | `Resumes ~{from}–{to}: <em>before decision</em>` | R6, R9 | `Restart about {from}–{to}: <em>before the cutoff</em>` |
| `en.json:161` | `Resumes ~{from}–{to}: <em>spans decision</em>` | R6, R9 | `Restart about {from}–{to}: <em>spans the cutoff</em>` |
| `en.json:162` | `Resumes ~{from}–{to}: <em>past decision</em>` | R6, R9 | `Restart about {from}–{to}: <em>after the cutoff</em>` |
| `en.json:175` | `<10%` | R9 | `under 10%` |
| `en.json:176` | `>90%` | R9 | `over 90%` |
| `en.json:229` | `Transfer ticket OK` | R9 | `Transfer service` |
| `en.json:230` | `Checking…` | R7 | `Checking` |
| `en.json:231` | `Waiting for service to resume is the surest option` | R9, R10 | `Wait for service to restart` |
| `en.json:268` | `Announcement: "{quote}"` | R11 | `Announcement: “{quote}”` |
| `en.json:271` | `Former dispatcher's knowledge` | R11 | `Former dispatcher’s knowledge` |
| `en.json:278` | `~{minutes} min` | R6 | `About {minutes} min` |
| `en.json:286` | `Usually resumes in about {duration}` | R9 | `Usually restarts in about {duration}` |
| `en.json:297` | `Add a new notice or announcement. Update the advice.` | R10 | `Add a new notice or announcement to update the advice.` |
| `en.json:299` | `Judgment details` | R9 | `Advice details` |
| `en.json:308` | `You're on the train, so we start from {station}` | R4 | `You are on the train, so we start from {station}` |
| `en.json:310` | `Cause not confirmed. We use the cutoff time as your cue` | R10 | `The cause is not confirmed. We use the cutoff time as your cue.` |
| `en.json:313` | `You're between stations, so we plan what to do once you reach {station}` | R4 | `You are between stations, so we plan what to do once you reach {station}` |
| `en.json:331` | `Trains ahead: usual spacing (estimated)` | R7 | `Trains ahead: assumed usual spacing` |
| `en.json:333` | `change` | R11 | `Change` |
| `en.json:355` | `The recommendation changed` | R9 | `The advice changed` |
| `en.json:410` | `Service actually resumed at {time}` | R9 | `Service actually restarted at {time}` |
| `en.json:416` | `Boarded after resumption` | R9 | `Boarded after the restart` |
| `en.json:422` | `Following the advice got you there {minutes} min earlier than waiting, in time for {deadline}.` | R8 | `Following the advice got you there {minutes} min earlier than waiting. You made it by {deadline}.` |
| `en.json:440` | `Arrival times are rough figures from the estimated travel times in each piece of advice and the time service actually resumed in the scenario.` | R8, R9 | `Arrival times are rough figures. They use the estimated travel time in each advice and the time service actually restarted.` |
| `en.json:456` | `Transfer OK` | R9 | `Transfer service` |
| `en.json:470` | `When an incident happens, crews put safety and recovery first, so announcements tend to stop at what happened.` | R8 | `When an incident happens, crews put safety and recovery first. Announcements tend to stop at what happened.` |
| `en.json:481` | `We read signals from the notices you bring and estimate the current phase and a range for the time to resumption.` | R9 | `We read signals from the notices you bring and estimate the current phase and a range for the time until service restarts.` |
| `en.json:526` | `Which train were you planning to take?` | R10 | `Pick the train you planned to take` |
| `en.json:536` | `change` | R11 | `Change` |
| `en.json:537` | `Have a notice or sign?` | R10 | `Add a notice or sign` |
| `en.json:567` | `Using a major station that way` | R10 | `Use a major station that way` |
| `en.json:568` | `Using the end of the line` | R10 | `Use the end of the line` |
| `en.json:572` | `Train fault / inspection` | R7 | `Train fault or inspection` |
| `en.json:573` | `Signals / points` | R7 | `Signals or points` |
| `en.json:579` | `Didn't catch it / nothing said` | R4, R7 | `Did not catch it or nothing said` |
| `en.json:584` | `Illness / emergency button on board` | R7 | `Illness or emergency button on board` |
| `en.json:590` | `Other / not sure` | R7 | `Other or not sure` |
| `en.json:603` | `They said it's undecided` | R4 | `They said it is undecided` |
| `en.json:604` | `Nothing said / not sure` | R7 | `Nothing said or not sure` |
| `en.json:647` | `Let's try that again` | R4 | `Try that again` |
| `templates.ts:20` | `公開情報と過去の傾向にもとづく推定です。駅や鉄道会社の公式発表を優先する。` | R2, R9 | `推定であり、公式発表を優先してください。` |
| `templates.ts:21` | `This is an estimate from public information and past patterns. Follow official station or railway announcements first.` | R9 | `Estimate only. Follow official notices.` |
| `templates.ts:51` | `Resuming by {time} makes waiting at least as fast as {route} arriving at {arrival}.` | R9 | `If service restarts by {time}, waiting is at least as fast as {route} arriving at {arrival}.` |
| `templates.ts:63` | `Resuming by {time} would have made waiting at least as fast as {route} arriving at {arrival}.` | R9 | `If service had restarted by {time}, waiting would have been at least as fast as {route} arriving at {arrival}.` |
| `templates.ts:77` | `Resuming by {time} lets you meet your {deadline} deadline without switching to {route} arriving at {arrival}.` | R9 | `If service restarts by {time}, you meet your {deadline} deadline without switching to {route} arriving at {arrival}.` |
| `templates.ts:89` | `{time}を過ぎた今は{deadline}の期限に向け{arrival}着の{route}に切り替える。` | R2, R8 | `{time}を過ぎました。{deadline}の期限に向けて、{route}に切り替えてください。` |
| `templates.ts:95` | `待つ場合と到着時刻を比べられる代わりの経路がないためいまはこのまま運転再開を待つ。` | R2, R8, R9 | `比べられる代わりの経路がありません。運転再開を待ってください。` |
| `templates.ts:96` | `Wait for service to resume because no alternative arrival is available for comparison.` | R9 | `No alternative arrival is available for comparison. Wait for service to restart.` |
| `templates.ts:103` | `No alternative route is available. Wait for service to resume.` | R9 | `No alternative route is available. Wait for service to restart.` |
| `templates.ts:295` | `Expect to reach {st} around {time} after service resumes. The {type} ahead cannot stop at {station} and is held short of it.` | R9 | `Expect to reach {st} around {time} after service restarts. The {type} ahead cannot stop at {station} and is held short of it.` |
| `templates.ts:301` | `Expect to reach {st} around {time} after service resumes. A {type} ahead occupies the platform at {station}.` | R9 | `Expect to reach {st} around {time} after service restarts. A {type} ahead occupies the platform at {station}.` |
| `templates.ts:312` | `{st}には{time}ごろに着く見込みです。前の列車との間隔はふだんどおりと仮定しています。` | R4 | `{st}には{time}ごろに着く見込みです。前の列車との間隔は通常どおりと仮定しています。` |
| `templates.ts:313` | `{st}には再開後の{time}ごろに着く見込みです。前の列車との間隔はふだんどおりと仮定しています。` | R4 | `{st}には再開後の{time}ごろに着く見込みです。前の列車との間隔は通常どおりと仮定しています。` |
| `templates.ts:316` | `Expect to reach {st} around {time} after service resumes. This assumes usual spacing to trains ahead.` | R9 | `Expect to reach {st} around {time} after service restarts. This assumes usual spacing to trains ahead.` |
| `templates.ts:331` | `Expect to reach {st} around {time} after service resumes.` | R9 | `Expect to reach {st} around {time} after service restarts.` |
| `templates.ts:334` | `{st}には{time}ごろに着く見込みです。前に{n}本つまっています。` | R11 | `{st}には{time}ごろに着く見込みです。前に{n}本詰まっています。` |
| `templates.ts:412` | `{be}を過ぎると待っては期限の{limit}に間に合いません。再開見込みは{p50}〜{p80}頃です。` | R11 | `…再開見込みは{p50}〜{p80}ごろです。` |
| `templates.ts:475` | `{be}を過ぎると{target}が早く着きます。再開見込みは{p50}〜{p80}頃です。` | R11 | `…再開見込みは{p50}〜{p80}ごろです。` |
| `templates.ts:484` | `延長後の見込みは{p80}頃で境目より後です。` | R11 | `延長後の見込みは{p80}ごろで境目より後です。` |
| `templates.ts:491` | `再開は{p50}頃の見込みで境目より後です。` | R11 | `再開は{p50}ごろの見込みで境目より後です。` |
| `templates.ts:501` | `再開見込みの大半が境目より後です。{p50}〜{p80}頃の見込みで境目まであと{minutes}分です。` | R11 | `再開見込みの大半が境目より後です。{p50}〜{p80}ごろの見込みで、境目まであと{minutes}分です。` |
| `templates.ts:520` | `再開見込みの{p50}頃と境目の差はわずかです。乗り換えるほどの差はありません。` | R11 | `再開見込みの{p50}ごろと境目の差はわずかです。乗り換えるほどの差はありません。` |
| `templates.ts:524` | `再開は{p50}頃の見込みで境目より前です。` | R11 | `再開は{p50}ごろの見込みで境目より前です。` |
| `templates.ts:637` | `Wait for service to resume.` | R9 | `Wait for service to restart.` |
| `templates.ts:732` | `Estimating the phase and time to resumption` | R9 | `Estimating the phase and the time until service restarts` |
| `templates.ts:734` | `代替経路を探しています` | R9 | `代わりの手段を探しています` |
| `templates.ts:736` | `Putting the judgment together` | R9 | `Putting the advice together` |
| `typical-flow.ts:38` | `{eventName}はふつう{span}分で終わります。` | R3, R4 | `{eventName}は多くの場合、{span}分で終わります。` |
| `typical-flow.ts:39` | `{eventName}: usually over in about {span} min.` | R10 | `{eventName} is usually over in about {span} min.` |
| `typical-flow.ts:43` | `{eventName}はふつう{duration}ほどで再開します。` | R4 | `{eventName}は多くの場合、約{duration}で再開します。` |
| `typical-flow.ts:44` | `{eventName}: service usually resumes in about {duration}.` | R9, R10 | `Service usually restarts in about {duration} after {eventName}.` |
| `judgment-system.md:67` | `…前の列車との間隔はふだんどおりと仮定しています。…前に2本つまっています。` | R4, R11 | `…前の列車との間隔は通常どおりと仮定しています。…前に2本詰まっています。` |
| `judgment-system.md:100` | `23時40分頃の見込みで…23時40分〜23時55分頃です。` | R11 | `23時40分ごろの見込みで…23時40分〜23時55分ごろです。` |
| `judgment-system.md:110` | `人身事故はふつう1時間ほどで再開します。…車内対応はふつう5〜10分で終わります。` | R3, R4 | `人身事故は多くの場合、約1時間で再開します。…急病人の救護は、多くの場合5〜10分で終わります。` |
| `judgment-system.md:116` | `Resuming by HH:MM makes waiting at least as fast as the route arriving at HH:MM.` | R9 | `If service restarts by HH:MM, waiting is at least as fast as the route arriving at HH:MM.` |
| `person-accident.ts:172` | `{clock}まで待つ。動かなければ阪急神戸線へ` | R5 | ja の見出しは「20時05分まで待つ」の形で渡す。{clock} に文用の時刻を使う |
| `person-accident.ts:180` | `{clock}までに再開すれば待つほうが早く着きます` | R2, R5 | {clock}までに再開すれば、待つほうが早く着きます。{clock} に文用の時刻を使う |
| `person-accident.ts:215` | `This is an estimate. Always follow official announcements.` | R9 | `Estimate only. Follow official notices.` |
| `person-accident.ts:236` | `{clock}までに再開しなかったため、阪急神戸線の振替のほうが早く着きます` | R2, R5 | {clock}までに再開しなかったため、阪急神戸線の振替のほうが早く着きます。{clock} に文用の時刻を使う |
| `person-accident.ts:267` | `This is an estimate. Always follow official announcements.` | R9 | `Estimate only. Follow official notices.` |
| `signal-text.ts:21` | `Seen in the "{name}" phase` | R11 | `Seen in the “{name}” phase` |
| `session.ts:372` | `{time}の10分雨量 {mm}mm、{warnings}（出典: 気象庁）。英語は (source: JMA)` | R7 | `{time}の10分雨量は{mm}mmです。{warnings}が出ています。出典は気象庁です。` |
| `session.ts:384` | `再開して乗れるまで p50 {n}分・p80 {n}分` | R3 | `再開して乗れるまで{p50}〜{p80}分` |
| `session.ts:385` | `Until a boardable train: p50 {n} min, p80 {n} min` | R3 | `Until you can board: {p50}–{p80} min` |
| `session.ts:392` | `代替手段の到着時刻の比較` | R9 | `代わりの手段の到着時刻の比較` |
| `geo-provider.ts:289` | `Wait for resumption` | R9 | `Wait for service to restart` |
| `app.ts:48` | `観測は {n} 件までです` | R3, R6 | `発表や掲示は{n}件までです` |
| `app.ts:54` | `画像は {n}MB までです` | R6 | `画像は{n}MBまでです` |
| `app.ts:98` | `リクエストが大きすぎます` | R3 | `送った内容が大きすぎます` |
| `app.ts:105` | `リクエストが多すぎます。しばらくしてから再試行してください` | R3 | `アクセスが集中しています。しばらく待ってから、もう一度試してください。` |
| `app.ts:115` | `リクエストが不正です: {issues}` | R3 | `送った内容に誤りがあります: {issues}` |
| `app.ts:152` | `判断に失敗しました。再試行してください` | R3 | `判断を出せませんでした。もう一度試してください。` |
| `run-judge.ts:101` | `読み取りに失敗しました。再試行するか文章で入力してください。` | R3 | `読み取れませんでした。もう一度試すか、文章で入力してください。` |
| `run-judge.ts:110` | `写真の読み取りには Claude の API キーが必要です。発表文の貼り付けか選択式で入力してください。` | R3 | `写真の読み取りは、いまは使えません。発表文を貼り付けるか、選んで答えてください。` |

## 数え上げ

1 行の中で複数の決まりに反するときは、それぞれの決まりに 1 件ずつ数える。そのため、決まりごとの件数の合計は行数より多い。

| 決まり | 内容 | 件数 |
|---|---|---|
| R1 | 見出し・ボタンの言い切り（日） | 4 |
| R2 | 文はです・ます調（日） | 49 |
| R3 | 指令・内部の言葉 | 16 |
| R4 | 話し言葉 | 16 |
| R5 | 時刻の書き方 | 18 |
| R6 | 数と単位の書き方 | 34 |
| R7 | 括弧・記号で補足しない | 15 |
| R8 | 1 文 1 主張 | 10 |
| R9 | 用語の統一 | 43 |
| R10 | 英語の形 | 15 |
| R11 | 表記 | 16 |
| 合計 |  | 236 |

違反の行数は 197 行である。

| ファイル | 行数 |
|---|---|
| `ja.json` | 91 |
| `en.json` | 52 |
| `templates.ts` | 27 |
| `typical-flow.ts` | 4 |
| `judgment-system.md` | 4 |
| `person-accident.ts` | 5 |
| `signal-text.ts` | 1 |
| `session.ts` | 4 |
| `geo-provider.ts` | 1 |
| `app.ts` | 6 |
| `run-judge.ts` | 2 |

## 開発者に確認したい点

- 「車内対応」は `packages/schema/test/fixtures/dev-content/knowledge/in_car_response.yaml` のダミー知見の名前である。本番の知見の名前が同じなら、`knowledge/` は開発者が書く決まりなので、「急病人の救護」などへの変更を開発者に頼む。判断の文は `{eventName}` にその名前を差し込む。
- 入口の質問のうち、ja.json の見出し（R1）と補足（R2）の境が決まりの表のとおりでよいか確かめる。`*Question` は札、`*Hint` と `*Note` は文として扱った。
- ja の文に差し込む時刻を「21時40分」にするには、`formatClockTime` とは別に文用の整形関数が要る。画面の ja メッセージのうち、文に時刻を差し込む 15 行がこの変更の対象である。
- R9 の「再開は restart、判断は advice」は、en の全文に及ぶ。内部の識別子 `resume_after_break_even` などは利用者に見えないので変えない。
