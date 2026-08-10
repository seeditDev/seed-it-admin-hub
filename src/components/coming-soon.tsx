import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function ComingSoon({
  title,
  description,
  icon: Icon,
  bullets,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  bullets: string[];
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>

      <Card className="glass-panel rounded-2xl">
        <CardContent className="flex flex-col items-start gap-5 p-8 sm:flex-row">
          <span className="brand-gradient flex size-14 shrink-0 items-center justify-center rounded-2xl text-primary-foreground">
            <Icon className="size-6" />
          </span>
          <div className="min-w-0">
            <Badge variant="secondary" className="rounded-full text-[11px]">
              Next build phase
            </Badge>
            <h2 className="font-display mt-3 text-lg font-semibold">
              This module is queued for the next pass
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              The shell, routing, roles and Firestore data layer are already wired, so this page slots
              straight in. Planned capabilities:
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              {bullets.map((b) => (
                <li key={b} className="flex gap-2 text-muted-foreground">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
