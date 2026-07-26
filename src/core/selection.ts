import type {
  ActionIntent,
  ActionKind,
  ActionSelectionTelemetry,
  ActionSpec,
} from "../types.js";

interface IndexedAction {
  action: ActionSpec;
  index: number;
}

export interface ActionSelectionResult {
  selected: ActionSpec[];
  telemetry: ActionSelectionTelemetry;
}

const kindOrder: ActionKind[] = ["mutation", "external", "local", "navigation"];
const intentOrder: ActionIntent[] = [
  "create",
  "update",
  "submit",
  "interact",
  "navigate",
  "external",
  "unknown",
  "delete",
];
const activationOrder: Array<NonNullable<ActionSpec["activation"]>> = [
  "enter",
  "submit",
  "check",
  "select",
  "click",
  "contextmenu",
  "hover",
  "record",
];

function orderedUnique<T>(values: Iterable<T>, order: readonly T[]): T[] {
  const present = new Set(values);
  return order.filter((value) => present.has(value));
}

function compareNumber(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function actionExecutionPriority(action: ActionSpec): number {
  if (/\b(log[ -]?out|sign[ -]?out|end session|revoke session)\b/i.test(action.label)) return 2;
  if (action.intent === "delete" || action.risk === "destructive") return 1;
  return 0;
}

function candidateOrder(
  left: IndexedAction,
  right: IndexedAction,
  deniedActionIds: ReadonlySet<string>,
  selectedPages: ReadonlySet<string>,
  selectedKinds: ReadonlySet<ActionKind>,
  selectedIntents: ReadonlySet<ActionIntent>,
  selectedActivations: ReadonlySet<ActionSpec["activation"]>,
): number {
  const comparisons = [
    compareNumber(Number(deniedActionIds.has(left.action.id)), Number(deniedActionIds.has(right.action.id))),
    compareNumber(actionExecutionPriority(left.action), actionExecutionPriority(right.action)),
    compareNumber(Number(selectedPages.has(left.action.pageUrl)), Number(selectedPages.has(right.action.pageUrl))),
    compareNumber(Number(selectedKinds.has(left.action.kind)), Number(selectedKinds.has(right.action.kind))),
    compareNumber(kindOrder.indexOf(left.action.kind), kindOrder.indexOf(right.action.kind)),
    compareNumber(Number(selectedIntents.has(left.action.intent)), Number(selectedIntents.has(right.action.intent))),
    compareNumber(intentOrder.indexOf(left.action.intent), intentOrder.indexOf(right.action.intent)),
    compareNumber(Number(selectedActivations.has(left.action.activation)), Number(selectedActivations.has(right.action.activation))),
    compareNumber(
      left.action.activation ? activationOrder.indexOf(left.action.activation) : activationOrder.length,
      right.action.activation ? activationOrder.indexOf(right.action.activation) : activationOrder.length,
    ),
    compareNumber(left.index, right.index),
  ];
  return comparisons.find((value) => value !== 0) ?? 0;
}

/**
 * Selects a bounded action set without letting discovery order on one route
 * starve the rest of the application. Known policy/environment denials remain
 * reportable, but only consume budget after runnable actions.
 */
export function selectActionsForExecution(
  actions: ActionSpec[],
  maxActions: number,
  deniedActionIds: ReadonlySet<string> = new Set(),
): ActionSelectionResult {
  const remaining = actions.map((action, index): IndexedAction => ({ action, index }));
  const selected: ActionSpec[] = [];
  const selectedPages = new Set<string>();
  const selectedKinds = new Set<ActionKind>();
  const selectedIntents = new Set<ActionIntent>();
  const selectedActivations = new Set<ActionSpec["activation"]>();
  const limit = Math.max(0, Math.min(Math.floor(maxActions), actions.length));

  const take = (next: IndexedAction): void => {
    selected.push(next.action);
    selectedPages.add(next.action.pageUrl);
    selectedKinds.add(next.action.kind);
    selectedIntents.add(next.action.intent);
    selectedActivations.add(next.action.activation);
  };

  if (limit === actions.length) {
    remaining.sort((left, right) =>
      compareNumber(Number(deniedActionIds.has(left.action.id)), Number(deniedActionIds.has(right.action.id)))
      || compareNumber(actionExecutionPriority(left.action), actionExecutionPriority(right.action))
      || compareNumber(left.index, right.index));
    for (const next of remaining) take(next);
  } else {
    while (selected.length < limit && remaining.length > 0) {
      remaining.sort((left, right) => candidateOrder(
        left,
        right,
        deniedActionIds,
        selectedPages,
        selectedKinds,
        selectedIntents,
        selectedActivations,
      ));
      const next = remaining.shift();
      if (!next) break;
      take(next);
    }
  }

  const eligiblePages = new Set(actions.map((action) => action.pageUrl));
  return {
    selected,
    telemetry: {
      strategy: "coverage-balanced-v1",
      eligibleActions: actions.length,
      selectedActions: selected.length,
      omittedActions: actions.length - selected.length,
      eligiblePages: eligiblePages.size,
      selectedPages: selectedPages.size,
      eligibleKinds: orderedUnique(actions.map((action) => action.kind), kindOrder),
      selectedKinds: orderedUnique(selected.map((action) => action.kind), kindOrder),
      eligibleIntents: orderedUnique(actions.map((action) => action.intent), intentOrder),
      selectedIntents: orderedUnique(selected.map((action) => action.intent), intentOrder),
      deniedEligibleActions: actions.filter((action) => deniedActionIds.has(action.id)).length,
      deniedSelectedActions: selected.filter((action) => deniedActionIds.has(action.id)).length,
    },
  };
}
