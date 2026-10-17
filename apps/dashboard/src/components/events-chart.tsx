import type { IssueStatsResponse } from "@mini-sentry/shared";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const hour = new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" });
const day = new Intl.DateTimeFormat("en", { weekday: "short", day: "numeric" });

export function EventsChart({ stats }: { stats: IssueStatsResponse }) {
  const format = stats.range === "24h" ? hour : day;
  const data = stats.buckets.map((b) => ({
    label: format.format(new Date(b.start)),
    count: b.count,
  }));

  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={24}
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
          />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            contentStyle={{
              background: "var(--popover)",
              color: "var(--popover-foreground)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value) => [value, "Events"]}
          />
          <Bar dataKey="count" fill="var(--chart-1)" radius={[3, 3, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
