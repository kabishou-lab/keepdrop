export type Role = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface Message {
  role: Role;
  content?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface Transcript {
  messages: Message[];
  /** Optional task reminder included in the judge state. */
  goal?: string;
}

export type QuestionType = "noul" | "choice" | "score";

export interface NoulQuestion {
  type: "noul";
  instructions: string;
}

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  options: Record<string, string | null>;
}

export interface ScoreQuestion {
  type: "score";
  instructions: string;
  levels: string[];
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;

export interface NoulAnswer {
  type: "noul";
  noul: number;
  confidence: number;
}

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface ScoreAnswer {
  type: "score";
  score: number;
  probabilities: number[];
  confidence: number;
}

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface DecideUsage {
  input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  n_retries: number;
  response_format: "json_schema" | "json_object" | "prompt";
}

export interface DecideOk {
  ok: true;
  answers: Record<string, Answer>;
  usage: DecideUsage;
  model: string;
  raw: string;
}

export interface DecideErr {
  ok: false;
  error: string;
  usage?: Partial<DecideUsage>;
  raw?: string;
}

export type DecideResult = DecideOk | DecideErr;

export type PairAction = "keep" | "drop_result" | "drop";

export interface PairDecision {
  id: string;
  name: string;
  action: PairAction;
  keep_call: number;
  keep_result: number;
  confidence_call: number;
  confidence_result: number;
  call_message_index: number;
  result_message_index: number;
}

export interface CompactResult {
  messages: Message[];
  decisions: PairDecision[];
  stats: {
    eligible: number;
    keep: number;
    drop_result: number;
    drop: number;
    chars_before: number;
    chars_after: number;
    tokens_before: number;
    tokens_after: number;
    input_tokens?: number;
    output_tokens?: number;
    usd_judge?: number;
    usd_saved_at_coder?: number;
    coder_usd_per_mtok?: number;
    fail_open: boolean;
    fail_reason?: string;
    model?: string;
    latency_ms?: number;
  };
}
