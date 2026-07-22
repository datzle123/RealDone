import type { ActionIntent, ActionKind, RiskLevel } from "../types.js";

const destructive = /\b(delete|remove|destroy|drop|refund|revoke|terminate|wipe|xo[aá]|xóa|gỡ|hoàn tiền|hủy tài khoản)\b/i;
const external = /\b(pay|purchase|subscribe|send|invite|email|sms|webhook|upload|export|checkout|thanh toán|gửi|mời|tải lên)\b/i;
const create = /\b(create|add|new|register|sign up|submit order|tạo|thêm|đăng ký)\b/i;
const update = /\b(save|update|edit|rename|change|apply|lưu|cập nhật|sửa|đổi)\b/i;
const navigation = /\b(open page|back|next|previous|view page|menu|tab|mở trang|quay lại|trang tiếp|xem trang)\b/i;

export function classifyAction(
  label: string,
  tag: string,
  href?: string,
  isForm = false,
): { kind: ActionKind; intent: ActionIntent; risk: RiskLevel } {
  if (tag === "a" || href) {
    if (destructive.test(label)) return { kind: "navigation", intent: "navigate", risk: "destructive" };
    if (external.test(label)) return { kind: "external", intent: "external", risk: "external" };
    return { kind: "navigation", intent: "navigate", risk: "safe" };
  }
  if (destructive.test(label)) {
    return { kind: "mutation", intent: "delete", risk: "destructive" };
  }
  if (external.test(label)) {
    return { kind: "external", intent: "external", risk: "external" };
  }
  if (create.test(label)) {
    return { kind: "mutation", intent: "create", risk: "safe" };
  }
  if (update.test(label)) {
    return { kind: "mutation", intent: "update", risk: "safe" };
  }
  if (/\b(search|find|filter|query)\b/i.test(label)) {
    return { kind: "local", intent: "interact", risk: "safe" };
  }
  if (isForm) {
    return { kind: "mutation", intent: "submit", risk: "safe" };
  }
  if (navigation.test(label)) {
    return { kind: "navigation", intent: "navigate", risk: "safe" };
  }
  return { kind: "local", intent: "interact", risk: "safe" };
}
