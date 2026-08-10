import { createFileRoute } from "@tanstack/react-router";
import { ClipboardList } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_portal/mcq-creator")({
  head: () => ({
    meta: [
      { title: "MCQ Creator | SEED-IT Admin" },
      { name: "description", content: "Author multi-section multiple-choice assessments." },
      { property: "og:title", content: "MCQ Creator | SEED-IT Admin" },
      { property: "og:description", content: "Author multi-section multiple-choice assessments." },
    ],
  }),
  component: () => (
    <ComingSoon
      title="MCQ Creator"
      description="Author multi-section multiple-choice assessments."
      icon={ClipboardList}
      bullets={[
        "Multi-section authoring with per-section marks and duration",
        "Positive and negative marking plus answer explanations",
        "Proctoring settings bar: camera, audio, tab-switch and violation limits",
      ]}
    />
  ),
});
