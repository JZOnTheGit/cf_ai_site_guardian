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

  // auto-scroll to the newest message, but only if the user is already near
  // the bottom - this way we don't yank them back if they scroll up to re-read
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // threshold of ~80px so tiny scroll jitter still counts as "at the bottom"
    if (distanceFromBottom < 80) {
      // use auto (not smooth) so rapidly streaming tokens don't fight each other
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, sending]);

  // send a message and stream the assistant reply token-by-token
  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    // show the user's message immediately and open an empty assistant bubble
    const userMsg: ChatMessage = { role: "user", content: text };
    const assistantMsg: ChatMessage = { role: "assistant", content: "" };
    setMessages((m) => [...m, userMsg, assistantMsg]);
    setInput("");
    try {
      // stream tokens into the last (assistant) bubble as they arrive
      await api.chatStream(agentId, text, (tok) => {
        setMessages((m) => {
          const next = m.slice();
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = { ...last, content: last.content + tok };
          }
          return next;
        });
      });
    } catch (err: any) {
      setError(err?.message ?? "Failed to send");
      // roll back both bubbles on failure
      setMessages((m) => m.slice(0, -2));
    } finally {
      setSending(false);
    }
  }

  return (
    // fixed height on mobile, viewport-bounded on desktop so the message list
    // scrolls inside the card instead of pushing the whole panel down the page
    <div className="card flex h-[600px] min-h-[560px] flex-col lg:h-[calc(100vh-3rem)] lg:max-h-[820px]">

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

        {/* actual message bubbles - the last assistant bubble streams tokens live */}
        {messages.map((m, i) => {
          const isLast = i === messages.length - 1;
          // show a pulsing cursor while the final assistant bubble is still streaming
          const stillStreaming = sending && isLast && m.role === "assistant";
          return (
            <Bubble
              key={i}
              role={m.role}
              content={m.content || (stillStreaming ? "..." : "")}
              pulsing={stillStreaming && m.content.length === 0}
            />
          );
        })}
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
