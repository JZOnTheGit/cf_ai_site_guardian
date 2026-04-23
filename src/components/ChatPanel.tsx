// chat panel that talks to the site agent
import { useEffect, useRef, useState } from "react";
import { api, type ChatMessage } from "../lib/api";

// props for the chat panel, just the agent id + callbacks from the dashboard
interface Props {
  agentId: string;
  onToast?: (msg: string, tone?: "info" | "success" | "error") => void;
  inputRef?: React.MutableRefObject<HTMLInputElement | null>;
}

// one assistant message that also carries which tool (if any) was used for it
interface UIMessage extends ChatMessage {
  tool?: string | null;
}

export function ChatPanel({ agentId, onToast, inputRef }: Props) {
  // local state for the chat
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const localInputRef = useRef<HTMLInputElement | null>(null);

  // on mount, hydrate the transcript from the DO
  useEffect(() => {
    api
      .messages(agentId)
      .then((msgs) => setMessages(msgs.map((m) => ({ ...m }))))
      .catch(() => {});
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
    const userMsg: UIMessage = { role: "user", content: text };
    const assistantMsg: UIMessage = { role: "assistant", content: "", tool: null };
    setMessages((m) => [...m, userMsg, assistantMsg]);
    setInput("");
    try {
      // stream tokens into the last (assistant) bubble as they arrive
      const { tool } = await api.chatStream(agentId, text, (tok) => {
        setMessages((m) => {
          const next = m.slice();
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = { ...last, content: last.content + tok };
          }
          return next;
        });
      });
      // once the stream ends, stamp which tool (if any) was used on this turn
      if (tool) {
        setMessages((m) => {
          const next = m.slice();
          const last = next[next.length - 1];
          if (last && last.role === "assistant") {
            next[next.length - 1] = { ...last, tool };
          }
          return next;
        });
      }
    } catch (err: any) {
      setError(err?.message ?? "Failed to send");
      // roll back both bubbles on failure
      setMessages((m) => m.slice(0, -2));
    } finally {
      setSending(false);
    }
  }

  // wipe the chat transcript on the server and in the ui
  async function clearChat() {
    if (!confirm("Clear the entire chat transcript for this agent?")) return;
    try {
      await api.clearChat(agentId);
      setMessages([]);
      onToast?.("Chat cleared", "success");
    } catch (err: any) {
      onToast?.(err?.message ?? "Failed to clear chat", "error");
    }
  }

  // keyboard shortcut: cmd/ctrl + enter sends the current input
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      send();
    }
  }

  // expose the input ref up to the page so cmd+k can focus it
  function setInputEl(el: HTMLInputElement | null) {
    localInputRef.current = el;
    if (inputRef) inputRef.current = el;
  }

  return (
    // fixed height on mobile, viewport-bounded on desktop so the message list
    // scrolls inside the card instead of pushing the whole panel down the page
    <div className="card flex h-[600px] min-h-[560px] flex-col lg:h-[calc(100vh-3rem)] lg:max-h-[820px]">
      {/* header with a tiny agent avatar + clear button */}
      <header className="flex items-center justify-between border-b border-ink-100 px-5 py-4 dark:border-ink-700">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-900 text-[11px] font-semibold text-white dark:bg-white dark:text-ink-900">
            SG
          </span>
          <div>
            <p className="text-sm font-semibold text-ink-900 dark:text-ink-100">
              Chat with your agent
            </p>
            <p className="text-xs text-ink-400">
              Grounded in this site's scan history
            </p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={clearChat}
            className="rounded-full border border-ink-200 bg-white px-2.5 py-1 text-[11px] font-medium text-ink-700 transition hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700"
          >
            Clear
          </button>
        )}
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
                "Run a fresh scan, please",
                "How has my performance changed?",
              ].map((s) => (
                <button
                  key={s}
                  className="pill hover:bg-ink-50 dark:hover:bg-ink-700"
                  onClick={() => setInput(s)}
                >
                  {s}
                </button>
              ))}
            </div>
            <p className="pt-3 text-[11px] text-ink-400">
              Tip: press <kbd className="rounded border border-ink-200 bg-white px-1 font-mono text-[10px] text-ink-600 dark:border-ink-700 dark:bg-ink-800 dark:text-ink-200">⌘K</kbd> to focus the chat.
            </p>
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
              tool={m.tool ?? null}
            />
          );
        })}
      </div>

      {/* error line if a send failed */}
      {error && <p className="px-5 pb-2 text-xs text-red-600">{error}</p>}

      {/* input form at the bottom */}
      <form
        onSubmit={send}
        className="flex items-center gap-2 border-t border-ink-100 px-3 py-3 dark:border-ink-700"
      >
        <input
          ref={setInputEl}
          className="flex-1 rounded-full border border-ink-200 bg-white px-4 py-2.5 text-sm
            placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-ink-900/10 focus:border-ink-300
            dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100 dark:placeholder:text-ink-500 dark:focus:ring-white/10"
          placeholder="Ask about performance, security, SEO..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={sending}
        />
        <button
          type="submit"
          className="btn-primary"
          disabled={sending || !input.trim()}
          title="Send (⌘+Enter)"
        >
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
  tool,
}: {
  role: ChatMessage["role"];
  content: string;
  pulsing?: boolean;
  tool?: string | null;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={[
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap",
          isUser
            ? "bg-ink-900 text-white rounded-br-md dark:bg-white dark:text-ink-900"
            : "bg-ink-50 text-ink-800 rounded-bl-md border border-ink-100 dark:bg-ink-700 dark:text-ink-100 dark:border-ink-600",
          pulsing ? "animate-pulse" : "",
        ].join(" ")}
      >
        {content}
      </div>
      {/* show a tiny chip when the assistant used a tool for this reply */}
      {!isUser && tool && (
        <span className="text-[10px] uppercase tracking-wider text-ink-400">
          via tool: {tool}
        </span>
      )}
    </div>
  );
}
