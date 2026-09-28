"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUp, Sparkles } from "lucide-react";

type CoachMessage = {
  role: "coach" | "creator";
  content: string;
};

const quickPrompts = [
  "Review a hook for me",
  "How can I improve my reach?",
  "Help me build stronger community",
];

function createCoachReply(prompt: string) {
  const question = prompt.toLowerCase();

  if (question.includes("hook") || question.includes("script")) {
    return "Start with one specific tension, not the lesson. For example: “The hardest part of discipline is keeping promises nobody else can see.” Then bring in your personal story, and end with one clear takeaway. That sequence gives the viewer a reason to stay.";
  }

  if (question.includes("community") || question.includes("relationship")) {
    return "Trade one broad call to action for a more personal question. After a relationship or purpose post, ask: “What truth are you learning to live out right now?” It gives people something meaningful to answer and makes your comments feel like a real gathering place.";
  }

  if (question.includes("brand") || question.includes("deal") || question.includes("product")) {
    return "Build proof before the pitch. Keep a running list of audience questions, saves, shares, and comments around a single theme. That evidence can guide a future guide or workshop, and it gives brands a clearer reason to trust your influence.";
  }

  if (question.includes("reach") || question.includes("views")) {
    return "Focus on clarity in the first five seconds. Make the opening about a recognizable problem, then let your wisdom and personal experience deliver the answer. Rework one strong idea into three hooks this week and compare which promise earns the best retention.";
  }

  return "I would turn that into one focused post: name the struggle, share the personal lesson, then give your audience a small next step. Keep the message honest and specific. That is what helps wisdom feel useful rather than distant.";
}

export function CoachConversation() {
  const [messages, setMessages] = useState<CoachMessage[]>([
    {
      role: "coach",
      content: "I’m here to help you turn your analytics into clearer content decisions. Bring me a hook, a script, a reach question, or a community goal, and we’ll work through it together.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const messageListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    messageListRef.current?.scrollTo({
      top: messageListRef.current.scrollHeight,
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [messages.length]);

  function sendMessage(message: string) {
    const trimmedMessage = message.trim();

    if (!trimmedMessage) {
      return;
    }

    setMessages((current) => [
      ...current,
      { role: "creator", content: trimmedMessage },
      { role: "coach", content: createCoachReply(trimmedMessage) },
    ]);
    setDraft("");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendMessage(draft);
  }

  return (
    <section className="coach-conversation-panel" aria-labelledby="coach-conversation-heading">
      <header className="coach-conversation-header">
        <div className="coach-icon" aria-hidden="true">
          <Sparkles size={20} />
        </div>
        <div>
          <p className="section-kicker">Creator growth coach</p>
          <h1 id="coach-conversation-heading">Build with intention.</h1>
          <p>Supportive strategy for faith, purpose, discipline, and relationships.</p>
        </div>
        <span className="coach-demo-badge">Demo</span>
      </header>

      <div className="coach-message-list" ref={messageListRef} role="log" aria-live="polite" aria-relevant="additions">
        {messages.map((message, index) => (
          <article className={`coach-message coach-message-${message.role}`} key={`${message.role}-${index}`}>
            <p>{message.content}</p>
          </article>
        ))}
      </div>

      <div className="coach-prompt-list" aria-label="Suggested coach questions">
        {quickPrompts.map((prompt) => (
          <button key={prompt} onClick={() => sendMessage(prompt)} type="button">
            {prompt}
          </button>
        ))}
      </div>

      <form className="coach-input-form" onSubmit={handleSubmit}>
        <label htmlFor="coach-question">Ask the coach</label>
        <div>
          <input
            id="coach-question"
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask about a hook, your reach, or your community..."
            value={draft}
          />
          <button aria-label="Send message" disabled={!draft.trim()} type="submit">
            <ArrowUp size={18} aria-hidden="true" />
          </button>
        </div>
      </form>

      <p className="coach-disclosure">Local demo responses based on the dashboard&apos;s sample analytics.</p>
    </section>
  );
}
