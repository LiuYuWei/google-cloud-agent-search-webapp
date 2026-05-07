"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

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

function renderAnswerWithCitations(message: AssistantMessage): React.ReactNode {
  const { text, citations } = message;
  if (!citations.length) return text;

  // Discovery Engine returns citation offsets in UTF-8 bytes — convert to JS
  // string indices so slicing the answer text matches the highlighted spans.
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const byteToCharIndex = new Map<number, number>();
  let bytePos = 0;
  for (let charPos = 0; charPos < text.length; charPos++) {
    byteToCharIndex.set(bytePos, charPos);
    bytePos += encoder.encode(text[charPos]).length;
  }
  byteToCharIndex.set(bytePos, text.length);
  const toChar = (byteIdx: number) =>
    byteToCharIndex.get(byteIdx) ??
    byteToCharIndex.get(Math.min(byteIdx, bytes.length)) ??
    text.length;

  const sorted = [...citations].sort((a, b) => a.startIndex - b.startIndex);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  sorted.forEach((c, i) => {
    const start = toChar(c.startIndex);
    const end = toChar(c.endIndex);
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <span
        key={`seg-${i}`}
        className="bg-amber-100/60 dark:bg-amber-300/15 rounded-sm"
      >
        {text.slice(start, end)}
        <sup className="ml-0.5 text-[0.65rem] text-amber-700 dark:text-amber-300">
          {c.sourceIndices.map((s) => `[${s + 1}]`).join("")}
        </sup>
      </span>,
    );
    cursor = end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

export default function Page() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [sessionName, setSessionName] = useState<string | undefined>(undefined);
  const userPseudoId = useMemo(getOrCreatePseudoId, []);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, pending]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const query = input.trim();
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
      setMessages((m) => [...m, { role: "error", text: `錯誤：${msg}` }]);
    } finally {
      setPending(false);
    }
  }

  function handleNewSession() {
    setSessionName(undefined);
    setMessages([]);
  }

  return (
    <main className="flex flex-1 flex-col mx-auto w-full max-w-3xl px-4 py-6">
      <header className="flex items-baseline justify-between border-b border-black/5 dark:border-white/10 pb-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold">RAG Q&A Demo</h1>
          <p className="text-xs text-black/60 dark:text-white/60 mt-1">
            根據已索引的 PDF / PPTX / HTML 回答問題，附帶引用
          </p>
        </div>
        <button
          type="button"
          onClick={handleNewSession}
          disabled={pending || messages.length === 0}
          className="text-xs px-3 py-1.5 rounded-md border border-black/10 dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          新對話
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-5 pr-1">
        {messages.length === 0 && (
          <div className="text-sm text-black/50 dark:text-white/50 mt-12 text-center">
            試試看：
            <ul className="mt-3 space-y-1.5">
              <li>「減重飲食有什麼建議？」</li>
              <li>「腎臟病人飲食有哪些注意事項？」</li>
              <li>「生酮飲食適合什麼人？」</li>
            </ul>
          </div>
        )}

        {messages.map((m, i) => {
          if (m.role === "user") {
            return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl bg-blue-600 text-white px-4 py-2 whitespace-pre-wrap text-sm">
                  {m.text}
                </div>
              </div>
            );
          }
          if (m.role === "error") {
            return (
              <div key={i} className="flex justify-start">
                <div className="max-w-[90%] rounded-2xl bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 px-4 py-2 text-sm whitespace-pre-wrap">
                  {m.text}
                </div>
              </div>
            );
          }
          return (
            <div key={i} className="flex flex-col items-start gap-2">
              <div className="max-w-full rounded-2xl bg-black/5 dark:bg-white/5 px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
                {renderAnswerWithCitations(m)}
              </div>
              {m.references.length > 0 && (
                <details className="text-xs w-full">
                  <summary className="cursor-pointer text-black/60 dark:text-white/60 hover:text-black/80 dark:hover:text-white/80">
                    引用來源（{m.references.length}）
                  </summary>
                  <ol className="mt-2 space-y-2 pl-4 list-decimal">
                    {m.references.map((r) => (
                      <li key={r.index}>
                        <div className="font-medium break-all">
                          {r.title || r.uri || `Reference ${r.index + 1}`}
                        </div>
                        {r.uri && (
                          <div className="text-black/50 dark:text-white/50 break-all">
                            {r.uri}
                          </div>
                        )}
                        {r.snippet && (
                          <div className="mt-1 text-black/70 dark:text-white/70 line-clamp-3">
                            {r.snippet}
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </div>
          );
        })}

        {pending && (
          <div className="flex items-center gap-2 text-sm text-black/50 dark:text-white/50">
            <span className="h-2 w-2 rounded-full bg-current animate-pulse" />
            正在查詢資料並產生回答…
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="mt-4 flex items-end gap-2 border-t border-black/5 dark:border-white/10 pt-3"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e as unknown as FormEvent);
            }
          }}
          placeholder="輸入問題（Enter 送出，Shift+Enter 換行）"
          rows={2}
          disabled={pending}
          className="flex-1 resize-none rounded-lg border border-black/10 dark:border-white/15 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || !input.trim()}
          className="rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/40 text-white px-4 py-2 text-sm font-medium"
        >
          送出
        </button>
      </form>
    </main>
  );
}
