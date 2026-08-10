import { createFileRoute } from "@tanstack/react-router";
import { UserSquare2 } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_portal/staff-management")({
  head: () => ({
    meta: [
      { title: "Staff Management | SEED-IT Admin" },
      { name: "description", content: "Create faculty accounts and scope their tenant access." },
      { property: "og:title", content: "Staff Management | SEED-IT Admin" },
      { property: "og:description", content: "Create faculty accounts and scope their tenant access." },
    ],
  }),
  component: () => (
    <ComingSoon
      title="Staff Management"
      description="Create faculty accounts and scope their tenant access."
      icon={UserSquare2}
      bullets={[
        "Provision staff credentials via the isolated secondary auth app",
        "Assign role staff plus a tenant access scope",
        "Suspend, edit and audit staff accounts",
      ]}
    />
  ),
});
