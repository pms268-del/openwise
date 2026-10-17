"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Refreshes server data while background jobs run, nudging the durable job queue each tick. */
export function AutoRefresh({ ms = 3000 }: { ms?: number }) {
  const r = useRouter();
  useEffect(() => {
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try { await fetch("/api/jobs/kick", { method: "POST" }); } catch { /* cron will pick it up */ }
      busy = false;
      r.refresh();
    };
    void tick(); // kick immediately so waiting users never depend on the timer
    const t = setInterval(tick, ms);
    return () => clearInterval(t);
  }, [r, ms]);
  return null;
}
