import { createFileRoute } from "@tanstack/react-router";
import { BarChart3 } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_portal/reports")({
  head: () => ({
    meta: [
      { title: "Reports & Student Analysis | SEED-IT Admin" },
      { name: "description", content: "Performance, rankings and proctoring violation history." },
      { property: "og:title", content: "Reports & Student Analysis | SEED-IT Admin" },
      { property: "og:description", content: "Performance, rankings and proctoring violation history." },
    ],
  }),
  component: () => (
    <ComingSoon
      title="Reports & Student Analysis"
      description="Performance, rankings and proctoring violation history."
      icon={BarChart3}
      bullets={[
        "Performance overview by college, cohort and assessment",
        "Score breakdowns, rank lists and pass/fail ratios",
        "Proctoring violation logs with Excel and PDF export",
      ]}
    />
  ),
});
