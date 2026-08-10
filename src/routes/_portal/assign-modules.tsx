import { createFileRoute } from "@tanstack/react-router";
import { ListChecks } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_portal/assign-modules")({
  head: () => ({
    meta: [
      { title: "Module Assignment Matrix | SEED-IT Admin" },
      { name: "description", content: "Assign assessment modules to college cohorts." },
      { property: "og:title", content: "Module Assignment Matrix | SEED-IT Admin" },
      { property: "og:description", content: "Assign assessment modules to college cohorts." },
    ],
  }),
  component: () => (
    <ComingSoon
      title="Module Assignment Matrix"
      description="Assign assessment modules to college cohorts."
      icon={ListChecks}
      bullets={[
        "Tenant and cohort selection with live allowedModules counts",
        "Dual-list transfer box for available vs assigned assessments",
        "One-click sync to tenants/{tenantId}/cohorts/{cohortId}.allowedModules",
      ]}
    />
  ),
});
