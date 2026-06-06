"use client";
import { useEffect, useState } from "react";

export function Clock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!now) return null;

  return (
    <div className="text-right leading-tight select-none">
      <div className="text-xs font-medium text-slate-700">{now.toLocaleTimeString()}</div>
      <div className="text-xs text-slate-500">{now.toLocaleDateString()}</div>
    </div>
  );
}
