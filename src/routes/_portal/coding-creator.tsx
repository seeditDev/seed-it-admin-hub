import { createFileRoute } from "@tanstack/react-router";
import { Code2 } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_portal/coding-creator")({
  head: () => ({
    meta: [
      { title: "Coding Creator | SEED-IT Admin" },
      { name: "description", content: "Author coding problems with test cases and judge limits." },
      { property: "og:title", content: "Coding Creator | SEED-IT Admin" },
      { property: "og:description", content: "Author coding problems with test cases and judge limits." },
    ],
  }),
  component: () => (
    <ComingSoon
      title="Coding Creator"
      description="Author coding problems with test cases and judge limits."
      icon={Code2}
      bullets={[
        "Problem statement, constraints and worked examples",
        "Starter code templates for Python, C++, Java and JavaScript",
        "Visible and hidden test cases with time and memory limits",
      ]}
    />
  ),
});
