"use client";

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar } from "recharts";

const axis = { stroke: "var(--muted)", fontSize: 11, tickLine: false, axisLine: false };

export function ImpressionsChart({ data }: { data: { day: string; impressions: number; engagement: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ left: -10, right: 8, top: 8 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="day" {...axis} />
        <YAxis {...axis} />
        <Tooltip contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", fontSize: 12 }} />
        <Line type="monotone" dataKey="impressions" stroke="var(--accent)" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function HourChart({ data }: { data: { hour: string; score: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ left: -10, right: 8, top: 8 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="hour" {...axis} />
        <YAxis {...axis} />
        <Tooltip contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", fontSize: 12 }} />
        <Bar dataKey="score" fill="var(--accent)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
