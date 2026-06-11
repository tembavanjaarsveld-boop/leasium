"use client";

import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Link2, Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button, Field, Input, SecondaryButton } from "@/components/ui";
import {
  askLeasium,
  type AskCitationRecord,
  type AskRecord,
} from "@/lib/api";
import { friendlyError } from "@/lib/utils";

/**
 * Ask Leasium AI — natural-language Q&A panel on the operator dashboard.
 *
 * Backend `/api/v1/ai/ask` (Tier 2 (e) per docs/product-roadmap.md) takes
 * an entity ID + question, builds a bounded context dump, and calls
 * OpenAI with a strict-JSON citation schema. This panel renders the
 * question form, suggestion chips, response card with citations, and
 * the guardrail disclosure. Read-only: Leasium AI never mutates state.
 *
 * Extracted from the monolithic dashboard.tsx per
 * `docs/external-design-review-2026-05-23.md` §1.2 (page-file size
 * policy). Pending Remba review.
 */

const ASK_LEASIUM_SUGGESTIONS = [
  "Which leases expire in the next 90 days?",
  "Which properties are vacant right now?",
  "What maintenance work is open and unassigned?",
  "Which tenants have arrears over $5,000?",
];

function citationKindLabel(kind: AskCitationRecord["kind"]): string {
  switch (kind) {
    case "property":
      return "Property";
    case "lease":
      return "Lease";
    case "tenant":
      return "Tenant";
    case "obligation":
      return "Obligation";
    case "maintenance_work_order":
      return "Maintenance";
    case "arrears_case":
      return "Arrears";
    default:
      return "Source";
  }
}

export function AskLeasiumPanel({ entityId }: { entityId: string }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AskRecord | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const askMutation = useMutation({
    mutationFn: (payload: { entity_id: string; question: string }) =>
      askLeasium(payload),
    onMutate: () => {
      setErrorMessage(null);
    },
    onSuccess: (record) => {
      setAnswer(record);
    },
    onError: (error) => {
      setErrorMessage(friendlyError(error));
      setAnswer(null);
    },
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || !entityId) return;
    askMutation.mutate({ entity_id: entityId, question: trimmed });
  };

  const handleSuggestion = (suggestion: string) => {
    setQuestion(suggestion);
    if (!entityId) return;
    setErrorMessage(null);
    askMutation.mutate({ entity_id: entityId, question: suggestion });
  };

  const handleReset = () => {
    setQuestion("");
    setAnswer(null);
    setErrorMessage(null);
  };

  const isPending = askMutation.isPending;
  const disabled = !entityId || isPending;

  return (
    <section
      id="ask-leasium"
      className="relative overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-primary-soft/40 via-white to-accent-soft/25 shadow-leasiumXs"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent"
      />
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-leasium-teal text-white shadow-leasiumXs">
            <Sparkles size={18} />
          </div>
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-center gap-2 text-leasium-body-compact font-semibold leading-5">
              Leasium AI
              <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0 text-leasium-micro font-bold uppercase tracking-wide text-primary">
                Beta
              </span>
            </h3>
            <p className="mt-0.5 max-w-2xl text-xs leading-4 text-muted-foreground">
              Ask plain-English questions about your portfolio. Answers cite
              the records they came from. Read-only — Leasium AI will never
              act on a question.
            </p>
          </div>
        </div>
        {answer || errorMessage ? (
          <SecondaryButton onClick={handleReset} disabled={isPending}>
            Reset
          </SecondaryButton>
        ) : null}
      </div>
      <div className="grid gap-4 px-4 pb-4">
        <form onSubmit={handleSubmit} className="grid gap-2">
          <Field label="Your question">
            <div className="flex flex-wrap items-stretch gap-2">
              <Input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Which leases expire in the next 90 days?"
                disabled={disabled}
                aria-label="Ask Leasium question"
                className="flex-1 min-w-[200px]"
              />
              <Button type="submit" disabled={disabled || !question.trim()}>
                {isPending ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" /> Asking…
                  </span>
                ) : (
                  "Ask"
                )}
              </Button>
            </div>
          </Field>
          {!entityId ? (
            <p className="text-xs text-muted-foreground">
              Choose an entity above before asking a question.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {ASK_LEASIUM_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => handleSuggestion(suggestion)}
                  disabled={disabled}
                  className="inline-flex min-h-11 items-center rounded-full border border-border bg-muted/30 px-3 text-xs text-muted-foreground transition duration-200 ease-leasium hover:border-primary/40 hover:bg-primary/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
        </form>

        {errorMessage ? (
          <div className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
            {errorMessage}
          </div>
        ) : null}

        {answer ? (
          <div className="grid gap-3 rounded-md border border-border bg-white p-4">
            <div className="whitespace-pre-wrap text-sm text-foreground">
              {answer.answer}
            </div>
            {answer.warnings.length ? (
              <div className="grid gap-1 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs text-warning-foreground">
                {answer.warnings.map((warning, idx) => (
                  <div key={idx} className="flex items-start gap-1.5">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    <span>{warning}</span>
                  </div>
                ))}
              </div>
            ) : null}
            {answer.citations.length ? (
              <div className="grid gap-1.5">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Sources
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {answer.citations.map((citation) => {
                    const label = `${citationKindLabel(citation.kind)} · ${citation.label}`;
                    if (citation.href) {
                      return (
                        <Link
                          key={`${citation.kind}-${citation.target_id}`}
                          href={citation.href}
                          className="inline-flex min-h-11 items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-3 text-xs text-primary transition duration-200 ease-leasium hover:border-primary/60 hover:bg-primary/10"
                        >
                          <Link2 size={11} />
                          <span>{label}</span>
                        </Link>
                      );
                    }
                    return (
                      <span
                        key={`${citation.kind}-${citation.target_id}`}
                        className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border bg-muted/40 px-3 text-xs text-muted-foreground"
                      >
                        {label}
                      </span>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-warning/30 bg-warning/5 p-2 text-xs text-warning-foreground">
                No sources cited — treat as unverified and double-check before
                acting.
              </div>
            )}
            {answer.guardrails.length ? (
              <details className="text-xs text-muted-foreground">
                <summary className="flex min-h-11 cursor-pointer items-center font-semibold text-primary hover:text-primary-hover">
                  Guardrails
                </summary>
                <ul className="mt-1.5 ml-4 list-disc space-y-0.5">
                  {answer.guardrails.map((line, idx) => (
                    <li key={idx}>{line}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : !isPending && !errorMessage ? (
          <div className="rounded-md border border-dashed border-primary/20 bg-white/50 p-3 text-xs text-muted-foreground">
            Answers stay grounded in your portfolio. Leasium AI quotes the
            record it pulled the answer from, and won&apos;t take any action.
          </div>
        ) : null}
      </div>
    </section>
  );
}
