/**
 * Jev (TypeSafe AI, #27), a decision model: it picks among options it is given and returns a
 * probability for each, and writes no text. Its first job is News or Learning for each story
 * (#81), where Learning means craft. Not on Bedrock: it runs on TypeSafe's API, with the key in
 * SSM. Behind a small port so tests can fake it.
 */
import { READER } from "./enrich.js";

export const JEV_PARAM = "/thelibrary/prod/jev/api-key";
export const JEV_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODEL = "jev-latest";

/** A yes/no question, answered with the probability of yes. */
export interface NoulQuestion {
  type: "noul";
  question: string;
  criteria: { true: string; false: string };
}

/** A pick among options, each described in `criteria`. */
export interface ChoiceQuestion {
  type: "choice";
  question: string;
  criteria: Record<string, string>;
}

export type Question = NoulQuestion | ChoiceQuestion;

export type Answer =
  | { type: "noul"; noul: number }
  | {
      type: "choice";
      choice: string;
      confidence: number;
      probabilities: Record<string, number>;
    };

export interface Decision {
  model: string;
  answers: Record<string, Answer>;
  inputTokens: number;
  outputTokens: number;
}

export interface DecisionPort {
  decide(state: string, questions: Record<string, Question>): Promise<Decision>;
}

export class Jev implements DecisionPort {
  constructor(
    private readonly key: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async decide(state: string, questions: Record<string, Question>): Promise<Decision> {
    for (let attempt = 1; ; attempt++) {
      const res = await this.fetchImpl(JEV_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${this.key}`, "content-type": "application/json" },
        body: JSON.stringify({ model: JEV_MODEL, state, questions }),
      });
      // Rate limits and server errors are retried; anything else is the request's fault.
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
      if (!res.ok) throw new Error(`jev ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const body = (await res.json()) as {
        model: string;
        answers: Record<string, Answer>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      return {
        model: body.model,
        answers: body.answers,
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
      };
    }
  }
}

/**
 * What Learning means (Sandip, 2026-10-12): craft, not shelf life. How to use a tool, or how it
 * works, is Learning; that it launched is News, even when it is a new kind of tool (2026-10-17).
 * Rewordings scored no better; see docs/features/story-shelves.md.
 */
export const CRAFT =
  "Builds the reader's craft: product management, system design, software engineering, " +
  "how to build with AI, startup and business strategy. How-tos, explanations of how a system " +
  "works, case studies of how a team built or decided something, frameworks, and interviews " +
  "about doing the work.";

export const NOT_CRAFT =
  "Reports or comments on what happened: news, launches, releases, funding and deals, markets, " +
  "politics, the industry's moves and people. Also essays on culture, society or life, and " +
  "consumer tech, even when they stay worth reading.";

/**
 * The one question every story gets. A choice between the two shelves scored worse against
 * Sandip's labels than this yes or no (#81).
 */
export const SHELF_QUESTIONS: Record<"craft", Question> = {
  craft: {
    type: "noul",
    question: "Does this story build the reader's craft?",
    criteria: { true: CRAFT, false: NOT_CRAFT },
  },
};

/** Unsure answers. They are shelved by 0.5 like the rest; the stored probability finds them later. */
export const UNSURE = { from: 0.4, to: 0.6 } as const;

export const isUnsure = (p: number) => p >= UNSURE.from && p < UNSURE.to;

export function storyState(s: { publication: string; headline: string; summary: string }) {
  return [
    READER,
    `Newsletter: ${s.publication}`,
    `Headline: ${s.headline}`,
    `Summary: ${s.summary}`,
  ].join("\n");
}

/** The probability that the story is Learning, from either phrasing; anything off throws. */
export function learningProbability(answer: Answer | undefined): number {
  const p =
    answer?.type === "choice"
      ? answer.probabilities?.learning
      : answer?.type === "noul"
        ? answer.noul
        : undefined;
  if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) {
    throw new Error(`unusable jev answer: ${JSON.stringify(answer)}`);
  }
  return p;
}
