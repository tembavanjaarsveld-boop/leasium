"use client";

import { LockKeyhole } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

import { LeasiumMark } from "@/components/brand";

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  return value;
}

export default function AccessPage() {
  const [password, setPassword] = useState("");
  const [nextPath, setNextPath] = useState("/");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setNextPath(safeNextPath(new URLSearchParams(window.location.search).get("next")));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    const response = await fetch("/api/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, next: nextPath }),
    });

    if (!response.ok) {
      setSubmitting(false);
      setError("That password does not look right.");
      return;
    }

    const body = (await response.json()) as { next?: string };
    window.location.assign(safeNextPath(body.next ?? nextPath));
  }

  return (
    <main className="grid min-h-screen place-items-center bg-leasium-bg px-5 py-10">
      <section className="w-full max-w-md rounded-2xl border border-border bg-white p-6 shadow-leasiumSm">
        <div className="flex items-center gap-3">
          <LeasiumMark className="h-12 w-12" />
          <div>
            <h1 className="text-xl font-semibold">Relby access</h1>
            <p className="text-sm text-muted-foreground">
              Lease operations, automated
            </p>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-border bg-muted/35 p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary-soft p-2 text-primary">
              <LockKeyhole size={18} />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Private beta</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Enter the temporary access password to continue.
              </p>
            </div>
          </div>
        </div>

        <form className="mt-5 grid gap-3" onSubmit={submit}>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-foreground">Password</span>
            <input
              autoComplete="current-password"
              autoFocus
              className="min-h-11 w-full rounded-xl border border-border bg-white px-3 text-sm outline-none transition-colors duration-200 ease-leasium focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/15"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </label>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-leasiumXs transition duration-200 ease-leasium hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!password || submitting}
            type="submit"
          >
            {submitting ? "Checking..." : "Continue"}
          </button>
        </form>
      </section>
    </main>
  );
}
