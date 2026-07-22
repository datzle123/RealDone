import { createInterface } from "node:readline/promises";

export interface ProjectActionConsentOptions {
  project: string;
  confirmed: boolean;
  interactive: boolean;
}

export type ConsentQuestion = (message: string) => Promise<string>;

export function consentPrompt(project: string): string {
  return `RealDone will operate visible actions in ${project}; app handlers may hide email, payment, webhook, or provider effects. Confirm this is a disposable local/staging project (y/N): `;
}

export async function requireProjectActionConsent(
  options: ProjectActionConsentOptions,
  question?: ConsentQuestion,
): Promise<void> {
  if (options.confirmed) return;
  if (!options.interactive) {
    throw new Error("Project action execution requires explicit confirmation in non-interactive mode. Re-run scan with --yes after confirming the target is disposable local/staging.");
  }

  let answer: string;
  if (question) {
    answer = await question(consentPrompt(options.project));
  } else {
    const readline = createInterface({ input: process.stdin, output: process.stderr });
    try {
      answer = await readline.question(consentPrompt(options.project));
    } finally {
      readline.close();
    }
  }
  if (!/^y(?:es)?$/i.test(answer.trim())) {
    throw new Error("Project action execution was not confirmed; no scan actions were run.");
  }
}
