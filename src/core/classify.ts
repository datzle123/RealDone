import type { ActionIntent, ActionKind, RiskLevel } from "../types.js";

const destructive = /\b(delete|remove|destroy|drop|refund|revoke|terminate|wipe|cancel subscription|close account|xo[aá]|xóa|gỡ|hoàn tiền|hủy tài khoản)\b/i;
const destructiveEndpoint = /(?:^|[./_-])(refunds?|revocations?|revoke|delete-account|remove-account|close-account|cancel-subscription|terminate-account)(?:$|[./_-])/i;
const external = /\b(pay|purchase|subscribe|send|invite|email|sms|webhook|upload|export|download|checkout|oauth|thanh toán|gửi|mời|tải lên)\b/i;
const externalEndpoint = /(?:^|[./_-])(payments?|payment-intents?|checkout|charges?|subscriptions?|emails?|sms|notifications?|push|invitations?|invites?|webhooks?|uploads?|exports?|shipments?|fulfillments?|transfers?|payouts?|stripe|paypal|twilio|sendgrid|resend|mailgun|s3|storage|slack|discord)(?:$|[./_-])/i;
const externalProvider = /\b(stripe|paypal|twilio|sendgrid|resend|mailgun|amazon s3|aws s3|supabase storage|oauth|slack|discord)\b/i;
const externalConnection = /\b(connect|sync|callback|endpoint|webhook|provider)\b/i;
const create = /\b(create|add|new|register|sign up|submit order|tạo|thêm|đăng ký)\b/i;
const update = /\b(save|update|edit|rename|change|apply|lưu|cập nhật|sửa|đổi)\b/i;
const navigation = /\b(open page|back|next|previous|view page|menu|tab|mở trang|quay lại|trang tiếp|xem trang)\b/i;

export interface ActionClassificationContext {
  pageUrl?: string;
  actionUrl?: string;
  method?: string;
  target?: string;
  download?: boolean;
  fieldTypes?: readonly string[];
  fieldHints?: readonly string[];
  semanticHints?: readonly string[];
}

export interface ActionClassification {
  kind: ActionKind;
  intent: ActionIntent;
  risk: RiskLevel;
  recordingRequired?: string;
}

interface DestinationSignals {
  endpoint: string;
  crossOrigin: boolean;
  externalProtocol: boolean;
  invalid: boolean;
}

function destinationSignals(actionUrl: string | undefined, pageUrl: string | undefined): DestinationSignals {
  if (!actionUrl) return { endpoint: "", crossOrigin: false, externalProtocol: false, invalid: false };
  try {
    const destination = new URL(actionUrl, pageUrl);
    const isHttp = destination.protocol === "http:" || destination.protocol === "https:";
    let crossOrigin = false;
    if (isHttp && pageUrl) {
      const source = new URL(pageUrl);
      crossOrigin = destination.origin !== source.origin;
    }
    return {
      endpoint: `${destination.hostname}${destination.pathname}`,
      crossOrigin,
      externalProtocol: !isHttp,
      invalid: false,
    };
  } catch {
    return { endpoint: actionUrl, crossOrigin: false, externalProtocol: false, invalid: true };
  }
}

export function classifyAction(
  label: string,
  tag: string,
  href?: string,
  isForm = false,
  context: ActionClassificationContext = {},
): ActionClassification {
  const actionUrl = context.actionUrl ?? href;
  const destination = destinationSignals(actionUrl, context.pageUrl);
  const fieldTypes = context.fieldTypes?.map((value) => value.toLowerCase()) ?? [];
  const fieldHints = context.fieldHints?.join(" ") ?? "";
  const semanticHints = context.semanticHints?.join(" ") ?? "";
  const semanticText = `${label} ${semanticHints}`;
  const hasFileField = fieldTypes.includes("file");
  const hasPasswordField = fieldTypes.includes("password");
  const hasUrlField = fieldTypes.includes("url");
  const hasUrlPlaceholder = context.fieldHints?.some((value) => /^https?:\/\//i.test(value.trim())) ?? false;
  const isLink = tag === "a" || Boolean(href);
  const method = context.method?.trim().toUpperCase();
  const methodCanMutate = !method || !["GET", "HEAD", "DIALOG"].includes(method);
  const endpointIsDestructive = destructiveEndpoint.test(destination.endpoint) || destructiveEndpoint.test(semanticText);
  const endpointIsExternal = externalEndpoint.test(destination.endpoint) || externalEndpoint.test(semanticText);
  const endpointExecutesEffect = endpointIsExternal && !isLink && (!isForm || methodCanMutate);
  const semanticsAreExternal = external.test(semanticText) || externalProvider.test(`${semanticText} ${fieldHints}`) || endpointExecutesEffect || context.download === true || destination.externalProtocol;
  const externalTargetField = (hasUrlField || hasUrlPlaceholder) && externalConnection.test(`${semanticText} ${fieldHints}`);
  const authPopup = destination.crossOrigin && context.target === "_blank" && /\b(oauth|sign[ -]?in|log[ -]?in|continue with|authenticate)\b/i.test(semanticText);

  if (destructive.test(semanticText) || endpointIsDestructive) {
    return isLink
      ? { kind: "navigation", intent: "navigate", risk: "destructive" }
      : { kind: "mutation", intent: "delete", risk: "destructive" };
  }

  if (hasFileField) {
    return {
      kind: "external",
      intent: "external",
      risk: "external",
      ...(!isForm || destination.crossOrigin || destination.externalProtocol || destination.invalid
        ? { recordingRequired: "Ambiguous or cross-origin file upload needs an explicit recorded file and sandbox policy." }
        : {}),
    };
  }

  if (isForm && (destination.crossOrigin || destination.externalProtocol || destination.invalid)) {
    return {
      kind: "external",
      intent: "external",
      risk: "external",
      recordingRequired: "Cross-origin or non-HTTP form submission needs a recorded flow and explicit sandbox policy.",
    };
  }

  if (authPopup) {
    return {
      kind: "external",
      intent: "external",
      risk: "external",
      recordingRequired: "Cross-origin authentication popup needs a recorded flow.",
    };
  }

  if (isForm && hasPasswordField) {
    return { kind: "mutation", intent: "submit", risk: "safe" };
  }

  if (semanticsAreExternal || externalTargetField) {
    return { kind: "external", intent: "external", risk: "external" };
  }

  if (isLink) {
    return { kind: "navigation", intent: "navigate", risk: "safe" };
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
