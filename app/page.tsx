"use client";

import {
  FormEvent,
  Fragment,
  KeyboardEvent,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown, { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

type Citation = {
  startIndex: number;
  endIndex: number;
  sourceIndices: number[];
};

type Reference = {
  index: number;
  title: string;
  uri: string;
  snippet: string;
};

type AssistantMessage = {
  role: "assistant";
  text: string;
  citations: Citation[];
  references: Reference[];
};

type UserMessage = { role: "user"; text: string };
type ErrorMessage = { role: "error"; text: string };
type Message = UserMessage | AssistantMessage | ErrorMessage;

const EXAMPLE_PROMPTS = [
  { emoji: "🥗", text: "減重飲食有什麼建議？" },
  { emoji: "🧂", text: "腎臟病人飲食有哪些注意事項？" },
  { emoji: "🥑", text: "生酮飲食適合什麼人？" },
  { emoji: "🍱", text: "腫瘤病人需要怎麼補充營養？" },
  { emoji: "💧", text: "需要限水的病人飲食要怎麼安排？" },
  { emoji: "🍞", text: "低纖維飲食可以吃哪些食物？" },
];

function getOrCreatePseudoId(): string {
  if (typeof window === "undefined") return "";
  const KEY = "rag-demo-pseudo-id";
  let id = window.localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(KEY, id);
  }
  return id;
}

function fileNameFromUri(uri: string): string {
  if (!uri) return "";
  const noQuery = uri.split("?")[0];
  const last = noQuery.split("/").filter(Boolean).pop() ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

// Discovery Engine returns citation startIndex / endIndex as UTF-8 byte
// offsets into answerText. JS strings are UTF-16, so we need a byte→char
// map to slice/insert at the right position.
function buildByteToCharIndex(text: string): (byteIdx: number) => number {
  const encoder = new TextEncoder();
  const map = new Map<number, number>();
  let bytePos = 0;
  for (let charPos = 0; charPos < text.length; charPos++) {
    map.set(bytePos, charPos);
    bytePos += encoder.encode(text[charPos]).length;
  }
  map.set(bytePos, text.length);
  return (byteIdx: number) =>
    map.get(byteIdx) ?? map.get(Math.min(byteIdx, bytePos)) ?? text.length;
}

const CITE_RE = /⟦CIT:([\d,]+)⟧/g;

// Insert sentinel tokens at each citation's end position so the citation
// markers ride along through the markdown renderer untouched as plain text.
function injectCitationSentinels(text: string, citations: Citation[]): string {
  if (!citations.length) return text;
  const toChar = buildByteToCharIndex(text);
  const sorted = [...citations].sort((a, b) => b.endIndex - a.endIndex);
  let out = text;
  for (const c of sorted) {
    const charEnd = toChar(c.endIndex);
    out =
      out.slice(0, charEnd) +
      `⟦CIT:${c.sourceIndices.join(",")}⟧` +
      out.slice(charEnd);
  }
  return out;
}

function fileTypeBadge(uri: string): { label: string; tone: string } {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".pdf"))
    return { label: "PDF", tone: "bg-rose-500/15 text-rose-600 dark:text-rose-300" };
  if (lower.endsWith(".pptx") || lower.endsWith(".ppt"))
    return { label: "PPT", tone: "bg-orange-500/15 text-orange-600 dark:text-orange-300" };
  if (lower.endsWith(".html") || lower.endsWith(".htm"))
    return { label: "HTML", tone: "bg-sky-500/15 text-sky-600 dark:text-sky-300" };
  if (lower.endsWith(".docx") || lower.endsWith(".doc"))
    return { label: "DOC", tone: "bg-blue-500/15 text-blue-600 dark:text-blue-300" };
  return { label: "DOC", tone: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300" };
}

function CitationBadge({
  ids,
  references,
}: {
  ids: number[];
  references: Reference[];
}) {
  const tooltip = ids
    .map((i) => {
      const r = references[i];
      if (!r) return `[${i + 1}]`;
      const file = fileNameFromUri(r.uri) || r.title || `Reference ${i + 1}`;
      return `[${i + 1}] ${file}`;
    })
    .join("\n");
  return (
    <sup
      title={tooltip}
      className="not-prose mx-0.5 inline-flex items-center px-1 py-px rounded bg-purple-500/12 text-purple-700 dark:text-purple-300 text-[10px] font-semibold align-super cursor-help no-underline"
    >
      [{ids.map((i) => i + 1).join(",")}]
    </sup>
  );
}

function decorateChildren(
  children: ReactNode,
  references: Reference[],
): ReactNode {
  const list = Array.isArray(children) ? children : [children];
  const out: ReactNode[] = [];
  list.forEach((child, idx) => {
    if (typeof child !== "string") {
      out.push(child);
      return;
    }
    let last = 0;
    let m: RegExpExecArray | null;
    CITE_RE.lastIndex = 0;
    while ((m = CITE_RE.exec(child)) !== null) {
      if (m.index > last) out.push(child.slice(last, m.index));
      const ids = m[1].split(",").map((n) => Number(n));
      out.push(
        <CitationBadge
          key={`cite-${idx}-${m.index}`}
          ids={ids}
          references={references}
        />,
      );
      last = CITE_RE.lastIndex;
    }
    if (last < child.length) {
      out.push(<Fragment key={`tail-${idx}-${last}`}>{child.slice(last)}</Fragment>);
    }
  });
  return out;
}

function buildMarkdownComponents(references: Reference[]): Components {
  const wrap = (Tag: keyof Components) =>
    (props: { children?: ReactNode }) => {
      const Component = Tag as unknown as React.ElementType;
      return <Component>{decorateChildren(props.children, references)}</Component>;
    };
  return {
    p: wrap("p"),
    li: wrap("li"),
    strong: wrap("strong"),
    em: wrap("em"),
    h1: wrap("h1"),
    h2: wrap("h2"),
    h3: wrap("h3"),
    h4: wrap("h4"),
    td: wrap("td"),
    th: wrap("th"),
  };
}

function BotIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M12 2v3M5 9a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V9Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="9.5" cy="12" r="1.2" fill="currentColor" />
      <circle cx="14.5" cy="12" r="1.2" fill="currentColor" />
      <path
        d="M3 12h2M19 12h2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function UserIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M5 20a7 7 0 0 1 14 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SendIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M4 12 20 4l-3 16-4.5-6.5L4 12Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ResetIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Page() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [sessionName, setSessionName] = useState<string | undefined>(undefined);
  const [showCitations, setShowCitations] = useState(true);
  const userPseudoId = useMemo(getOrCreatePseudoId, []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Restore the citation toggle preference on mount
  useEffect(() => {
    const saved = window.localStorage.getItem("rag-show-citations");
    if (saved !== null) setShowCitations(saved === "true");
  }, []);
  useEffect(() => {
    window.localStorage.setItem("rag-show-citations", String(showCitations));
  }, [showCitations]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, pending]);

  // Auto-grow textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [input]);

  async function send(query: string) {
    if (!query || pending) return;
    setMessages((m) => [...m, { role: "user", text: query }]);
    setInput("");
    setPending(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, sessionName, userPseudoId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || body.error || `HTTP ${res.status}`);
      }
      const data: {
        answerText: string;
        citations: Citation[];
        references: Reference[];
        sessionName: string;
      } = await res.json();
      setSessionName(data.sessionName);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: data.answerText || "(無回答)",
          citations: data.citations ?? [],
          references: data.references ?? [],
        },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((m) => [...m, { role: "error", text: `查詢失敗：${msg}` }]);
    } finally {
      setPending(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await send(input.trim());
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input.trim());
    }
  }

  function handleNewSession() {
    setSessionName(undefined);
    setMessages([]);
  }

  const hasMessages = messages.length > 0;

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 backdrop-blur bg-[var(--background)]/80 border-b border-[var(--border)]">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 grid place-items-center text-white shadow-sm">
              <BotIcon className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-[15px] font-semibold leading-tight">
                專業資料問答助理
              </h1>
              <p className="text-[11px] text-[var(--muted)] leading-tight">
                由 Vertex AI Search 驅動 · 答案附帶資料來源
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={showCitations}
              onClick={() => setShowCitations((v) => !v)}
              className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg border border-[var(--border)] hover:bg-black/5 dark:hover:bg-white/5 transition"
              title={showCitations ? "目前顯示來源編號，點擊隱藏" : "目前隱藏來源編號，點擊顯示"}
            >
              <span
                className={`relative inline-block h-4 w-7 rounded-full transition ${
                  showCitations
                    ? "bg-purple-600"
                    : "bg-zinc-300 dark:bg-zinc-600"
                }`}
              >
                <span
                  className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition ${
                    showCitations ? "left-3.5" : "left-0.5"
                  }`}
                />
              </span>
              <span className="hidden sm:inline">標注來源</span>
            </button>
            <button
              type="button"
              onClick={handleNewSession}
              disabled={pending || !hasMessages}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] hover:bg-black/5 dark:hover:bg-white/5 transition disabled:opacity-40 disabled:cursor-not-allowed"
              title="清空對話"
            >
              <ResetIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">新對話</span>
            </button>
          </div>
        </div>
      </header>

      {/* Chat area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6">
          {!hasMessages && (
            <div className="text-center pt-8 pb-4">
              <div className="mx-auto h-14 w-14 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 grid place-items-center text-white shadow-lg shadow-purple-500/20">
                <BotIcon className="h-7 w-7" />
              </div>
              <h2 className="mt-4 text-lg font-semibold">想問什麼問題？</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                從你上傳的 PDF / PPTX / HTML 中找答案，並附上引用片段
              </p>

              <div className="mt-7 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {EXAMPLE_PROMPTS.map((p) => (
                  <button
                    key={p.text}
                    type="button"
                    onClick={() => send(p.text)}
                    className="group text-left flex items-start gap-3 p-3.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] hover:border-purple-400/60 hover:shadow-sm transition"
                  >
                    <span className="text-xl leading-none">{p.emoji}</span>
                    <span className="text-sm leading-snug group-hover:text-purple-600 dark:group-hover:text-purple-300 transition">
                      {p.text}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-5">
            {messages.map((m, i) => {
              if (m.role === "user") {
                return (
                  <div key={i} className="msg-in flex justify-end gap-2.5">
                    <div className="max-w-[80%] rounded-2xl rounded-tr-md bg-gradient-to-br from-indigo-600 to-purple-600 text-white px-4 py-2.5 whitespace-pre-wrap text-sm shadow-sm">
                      {m.text}
                    </div>
                    <div className="h-8 w-8 shrink-0 rounded-full bg-zinc-200 dark:bg-zinc-700 grid place-items-center text-zinc-600 dark:text-zinc-300">
                      <UserIcon className="h-4 w-4" />
                    </div>
                  </div>
                );
              }
              if (m.role === "error") {
                return (
                  <div key={i} className="msg-in flex justify-start gap-2.5">
                    <div className="h-8 w-8 shrink-0 rounded-full bg-red-500/15 grid place-items-center text-red-600 dark:text-red-300">
                      !
                    </div>
                    <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 px-4 py-2.5 text-sm">
                      {m.text}
                    </div>
                  </div>
                );
              }
              const renderedText = showCitations
                ? injectCitationSentinels(m.text, m.citations)
                : m.text;
              const mdComponents = showCitations
                ? buildMarkdownComponents(m.references)
                : undefined;
              return (
                <div key={i} className="msg-in flex items-start gap-2.5">
                  <div className="h-8 w-8 shrink-0 rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 grid place-items-center text-white shadow-sm">
                    <BotIcon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-3">
                    <div className="rounded-2xl rounded-tl-md bg-[var(--surface)] border border-[var(--border)] px-4 py-3 shadow-sm">
                      <div className="prose-chat text-[14.5px] leading-relaxed">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={mdComponents}
                        >
                          {renderedText}
                        </ReactMarkdown>
                      </div>
                    </div>
                    {showCitations && m.references.length > 0 && (
                      <details className="group">
                        <summary className="cursor-pointer text-xs text-[var(--muted)] hover:text-foreground transition flex items-center gap-1.5 select-none">
                          <svg
                            viewBox="0 0 20 20"
                            className="h-3.5 w-3.5 transition group-open:rotate-90"
                            fill="currentColor"
                          >
                            <path d="M7 5l6 5-6 5V5z" />
                          </svg>
                          來源資料 · {m.references.length} 份
                        </summary>
                        <ol className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {m.references.map((r) => {
                            const file = fileNameFromUri(r.uri);
                            const badge = fileTypeBadge(r.uri);
                            return (
                              <li
                                key={r.index}
                                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-xs"
                              >
                                <div className="flex items-start gap-2">
                                  <span
                                    className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${badge.tone}`}
                                  >
                                    {badge.label}
                                  </span>
                                  <span className="font-medium leading-snug break-all">
                                    {r.title || file || `Reference ${r.index + 1}`}
                                  </span>
                                </div>
                                {file && r.title && file !== r.title && (
                                  <div className="mt-1 text-[var(--muted)] break-all">
                                    {file}
                                  </div>
                                )}
                                {r.snippet && (
                                  <div className="mt-2 text-[var(--muted)] line-clamp-3 leading-relaxed">
                                    {r.snippet}
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ol>
                      </details>
                    )}
                  </div>
                </div>
              );
            })}

            {pending && (
              <div className="msg-in flex items-start gap-2.5">
                <div className="h-8 w-8 shrink-0 rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 grid place-items-center text-white shadow-sm">
                  <BotIcon className="h-4 w-4" />
                </div>
                <div className="rounded-2xl rounded-tl-md bg-[var(--surface)] border border-[var(--border)] px-4 py-3 shadow-sm">
                  <div className="flex gap-1 items-center text-[var(--muted)]">
                    <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce" />
                    <span className="ml-2 text-xs">正在查資料…</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Composer */}
      <div className="sticky bottom-0 border-t border-[var(--border)] bg-[var(--background)]/85 backdrop-blur">
        <form
          onSubmit={handleSubmit}
          className="mx-auto max-w-3xl px-4 py-3"
        >
          <div className="flex items-end gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] focus-within:border-purple-400/60 focus-within:shadow-sm transition px-3 py-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="輸入你的問題…（Enter 送出，Shift+Enter 換行）"
              rows={1}
              disabled={pending}
              className="flex-1 resize-none bg-transparent text-sm leading-relaxed py-1.5 focus:outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={pending || !input.trim()}
              className="h-9 w-9 shrink-0 grid place-items-center rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 text-white disabled:from-zinc-300 disabled:to-zinc-300 dark:disabled:from-zinc-700 dark:disabled:to-zinc-700 disabled:cursor-not-allowed shadow-sm hover:shadow transition"
              aria-label="送出"
            >
              <SendIcon className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 text-[11px] text-center text-[var(--muted)]">
            回答由 AI 根據已索引的文件生成，請以原始資料為準
          </p>
        </form>
      </div>
    </div>
  );
}
