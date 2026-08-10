import { createFileRoute } from "@tanstack/react-router";
import { Mic } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";

export const Route = createFileRoute("/_portal/sea-creator")({
  head: () => ({
    meta: [
      { title: "SEA Creator | SEED-IT Admin" },
      { name: "description", content: "Author spoken-English audio assessments." },
      { property: "og:title", content: "SEA Creator | SEED-IT Admin" },
      { property: "og:description", content: "Author spoken-English audio assessments." },
    ],
  }),
  component: () => (
    <ComingSoon
      title="SEA Creator"
      description="Author spoken-English audio assessments."
      icon={Mic}
      bullets={[
        "Audio prompt authoring with reference transcripts",
        "Voice evaluation criteria: fluency, pronunciation, grammar",
        "Recording length limits and retake policy",
      ]}
    />
  ),
});
