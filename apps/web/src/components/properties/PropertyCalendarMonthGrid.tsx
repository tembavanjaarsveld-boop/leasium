"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { StatusBadge } from "@/components/ui";
import type { LeaseEventRecord } from "@/lib/api";

type PropertyCalendarMonthGridProps = {
  events: LeaseEventRecord[];
};

// The month grid uses its own tone scale (per the v2 spec): rent reviews read
// as warning, lease expiries as danger. Other lease event kinds fall back to
// neutral.
function monthGridTone(
  kind: LeaseEventRecord["kind"],
): "warning" | "danger" | "neutral" {
  if (kind === "rent_review") {
    return "warning";
  }
  if (kind === "lease_expiry") {
    return "danger";
  }
  return "neutral";
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_CHIPS_PER_CELL = 2;

function eventDateKey(event: LeaseEventRecord): string | null {
  return event.date ? event.date.slice(0, 10) : null;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

// Monday-start offset: getDay() returns 0 for Sunday, which we map to the
// trailing column.
function mondayOffset(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function isoDate(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(
    day,
  ).padStart(2, "0")}`;
}

export function PropertyCalendarMonthGrid({
  events,
}: PropertyCalendarMonthGridProps) {
  // Default to the earliest dated event so the most relevant month is in view
  // without the operator having to navigate. Falls back to the current month
  // when nothing is dated.
  const initialMonth = useMemo(() => {
    const datedTimes = events
      .map((event) => eventDateKey(event))
      .filter((value): value is string => Boolean(value))
      .map((value) => new Date(`${value}T00:00:00`).getTime())
      .filter((value) => Number.isFinite(value));
    if (!datedTimes.length) {
      return startOfMonth(new Date());
    }
    return startOfMonth(new Date(Math.min(...datedTimes)));
  }, [events]);

  const [visibleMonth, setVisibleMonth] = useState<Date>(initialMonth);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, LeaseEventRecord[]>();
    for (const event of events) {
      const key = eventDateKey(event);
      if (!key) {
        continue;
      }
      const bucket = map.get(key) ?? [];
      bucket.push(event);
      map.set(key, bucket);
    }
    return map;
  }, [events]);

  const monthLabel = new Intl.DateTimeFormat("en-AU", {
    month: "long",
    year: "numeric",
  }).format(visibleMonth);

  const year = visibleMonth.getFullYear();
  const monthIndex = visibleMonth.getMonth();
  const leadingBlanks = mondayOffset(visibleMonth);
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

  const cells: Array<{ date: string; day: number } | null> = [];
  for (let index = 0; index < leadingBlanks; index += 1) {
    cells.push(null);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ date: isoDate(year, monthIndex, day), day });
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  const navButtonClass =
    "inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-md border border-border bg-white px-3 text-sm font-semibold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2";

  return (
    <section className="grid gap-3 rounded-md border border-border bg-white p-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold" aria-live="polite">
          {monthLabel}
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={navButtonClass}
            aria-label="Previous month"
            onClick={() => setVisibleMonth((current) => addMonths(current, -1))}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            className={navButtonClass}
            aria-label="Today"
            onClick={() => setVisibleMonth(startOfMonth(new Date()))}
          >
            Today
          </button>
          <button
            type="button"
            className={navButtonClass}
            aria-label="Next month"
            onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </header>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((weekday) => (
          <div
            key={weekday}
            className="px-1 py-1 text-center text-leasium-micro font-semibold uppercase tracking-wide text-muted-foreground"
          >
            {weekday}
          </div>
        ))}
        {cells.map((cell, index) => {
          if (!cell) {
            return (
              <div
                key={`blank-${index}`}
                className="min-h-20 rounded-md border border-transparent bg-muted/20"
                aria-hidden="true"
              />
            );
          }
          const dayEvents = eventsByDate.get(cell.date) ?? [];
          const visibleEvents = dayEvents.slice(0, MAX_CHIPS_PER_CELL);
          const overflow = dayEvents.length - visibleEvents.length;
          return (
            <div
              key={cell.date}
              data-date={cell.date}
              className="grid min-h-20 content-start gap-1 rounded-md border border-border bg-white p-1"
            >
              <div className="text-right text-xs font-semibold tabular-nums text-muted-foreground">
                {cell.day}
              </div>
              {visibleEvents.map((event) => (
                <Link
                  key={event.id}
                  href={event.href}
                  aria-label={`${event.title} on ${cell.date}`}
                  title={event.title}
                  className="block"
                >
                  <StatusBadge
                    tone={monthGridTone(event.kind)}
                    className="w-full justify-start truncate text-leasium-micro"
                  >
                    {event.title}
                  </StatusBadge>
                </Link>
              ))}
              {overflow > 0 ? (
                <span className="px-1 text-leasium-micro font-medium text-muted-foreground">
                  +{overflow} more
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
