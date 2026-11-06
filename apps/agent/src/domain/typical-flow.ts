// 短く終わるか長くかかるかの区別は、画面と同じ閾値を使うため core に置く
// 再開までの分を文で言い切らないので、流れを文にする関数は置かない
export { classifyFlowOutlook, type FlowOutlook } from "@repo/core";
