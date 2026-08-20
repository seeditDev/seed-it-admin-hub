import { Link, useRouterState } from "@tanstack/react-router";
import {
  Building2,
  BookOpenCheck,
  ClipboardList,
  Code2,
  Database,
  GraduationCap,
  LayoutDashboard,
  ListChecks,
  Mic,
  Radio,
  Users,
  UserSquare2,
  BarChart3,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth-context";

interface NavItem {
  title: string;
  url: string;
  icon: typeof LayoutDashboard;
  adminOnly?: boolean;
}

const OVERVIEW: NavItem[] = [{ title: "Dashboard", url: "/dashboard", icon: LayoutDashboard }];

const MANAGE: NavItem[] = [
  { title: "Colleges & Cohorts", url: "/colleges", icon: Building2, adminOnly: true },
  { title: "Student Roster", url: "/students", icon: Users },
  { title: "Courses & Assessments", url: "/courses", icon: BookOpenCheck, adminOnly: true },
  { title: "Module Assignment", url: "/assign-modules", icon: ListChecks, adminOnly: true },
  { title: "Staff Management", url: "/staff-management", icon: UserSquare2, adminOnly: true },
];

const AUTHOR: NavItem[] = [
  { title: "MCQ Creator", url: "/mcq-creator", icon: ClipboardList },
  { title: "Coding Creator", url: "/coding-creator", icon: Code2 },
  { title: "SEA Creator", url: "/sea-creator", icon: Mic },
  { title: "Question Bank", url: "/question-bank", icon: Database },
];

const INSIGHTS: NavItem[] = [{ title: "Reports & Analysis", url: "/reports", icon: BarChart3 }];

const OPERATIONS: NavItem[] = [
  { title: "Live Assessment", url: "/live-assessment", icon: Radio, adminOnly: true },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { isAdmin, account } = useAuth();
  const currentPath = useRouterState({ select: (r) => r.location.pathname });

  const groups: Array<{ label: string; items: NavItem[] }> = [
    { label: "Overview", items: OVERVIEW },
    { label: "Administration", items: MANAGE },
    { label: "Operations", items: OPERATIONS },
    { label: "Assessment Authoring", items: AUTHOR },
    { label: "Insights", items: INSIGHTS },
  ];

  return (
    <Sidebar collapsible="icon" className="border-sidebar-border">
      <SidebarHeader className="px-3 py-4">
        <div className="flex items-center gap-3">
          <span className="brand-gradient flex size-9 shrink-0 items-center justify-center rounded-xl text-primary-foreground">
            <GraduationCap className="size-5" />
          </span>
          {!collapsed ? (
            <div className="min-w-0">
              <p className="font-display truncate text-sm font-bold text-sidebar-foreground">
                SEED-IT Admin
              </p>
              <p className="truncate text-[11px] uppercase tracking-[0.16em] text-sidebar-foreground/55">
                {account?.role === "staff" ? (account.tenantId || "Staff") : "Platform"}
              </p>
            </div>
          ) : null}
        </div>
      </SidebarHeader>

      <SidebarContent className="scroll-slim">
        {groups.map((group) => {
          const items = group.items.filter((item) => !item.adminOnly || isAdmin);
          if (items.length === 0) return null;
          return (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/45">
                {group.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton
                        asChild
                        isActive={currentPath === item.url}
                        tooltip={item.title}
                        className="rounded-xl"
                      >
                        <Link to={item.url} className="flex items-center gap-2.5">
                          <item.icon className="size-4 shrink-0" />
                          {!collapsed ? <span className="truncate">{item.title}</span> : null}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
    </Sidebar>
  );
}
