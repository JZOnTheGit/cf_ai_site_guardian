// chat panel that talks to the site agent
import { useEffect, useRef, useState } from "react";
import { api, type ChatMessage } from "../lib/api";

// props for the chat panel, just the agent id
interface Props {
  agentId: string;
}

export function ChatPanel({ agentId }: Props) {
  // local state for the chat
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // on mount, hydrate the transcript from the DO
  useEffect(() => {
    api.messages(agentId).then(setMessages).catch(() => {});
  }, [agentId]);

  // auto-scroll to the newest message whenever the list changes
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, sending]);

  // send a message, optimistically add it, then replace with the server truth
  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    // show the user's message immediately before the api responds
    const optimistic: ChatMessage = { role: "user", content: text };
    setMessages((m) => [...m, optimistic]);
    setInput("");
    try {
      const { history } = await api.chat(agentId, text);
      setMessages(history);
    } catch (err: any) {
      setError(err?.message ?? "Failed to send");
      // roll back the optimistic message on failure
      setMessages((m) => m.filter((x) => x !== optimistic));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card flex h-full min-h-[560px] flex-col">
      {/* header with a tiny agent avatar */}
      <header className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-900 text-[11px] font-semibold text-white">
            SG
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-900">Chat with your agent</p>
            <p className="text-xs text-ink-400">Grounded in this site's scan history</p>
          </div>
        </div>
      </header>

      {/* scrollable message list */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto px-5 py-4"
        aria-live="polite"
      >
        {/* empty state with quick-start prompts */}
        {messages.length === 0 && !sending && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-ink-400">
            <p>Ask the agent anything about this site.</p>
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              {[
                "What should I fix first?",
                "Has my site improved?",
                "Why is my site slow?",
              ].map((s) => (
                <button
                  key={s}
                  className="pill hover:bg-ink-50"
                  onClick={() => setInput(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* actual message bubbles */}
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role} content={m.content} />
        ))}
        {/* show a pulsing placeholder while the assistant is typing */}
        {sending && <Bubble role="assistant" content="..." pulsing />}
      </div>

      {/* error line if a send failed */}
      {error && <p className="px-5 pb-2 text-xs text-red-600">{error}</p>}

      {/* input form at the bottom */}
      <form
        onSubmit={send}
        className="flex items-center gap-2 border-t border-ink-100 px-3 py-3"
      >
        <input
          className="flex-1 rounded-full border border-ink-200 bg-white px-4 py-2.5 text-sm
            placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-ink-900/10 focus:border-ink-300"
          placeholder="Ask about performance, security, SEO..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={sending}
        />
        <button type="submit" className="btn-primary" disabled={sending || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

// one chat bubble, right-aligned for user and left-aligned for assistant
function Bubble({
  role,
  content,
  pulsing,
}: {
  role: ChatMessage["role"];
  content: string;
  pulsing?: boolean;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={[
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap",
          isUser
            ? "bg-ink-900 text-white rounded-br-md"
            : "bg-ink-50 text-ink-800 rounded-bl-md border border-ink-100",
          pulsing ? "animate-pulse" : "",
        ].join(" ")}
      >
        {content}
      </div>
    </div>
  );
}
