"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Account, Project } from "@/lib/types";
import { TopBar } from "@/components/crm/top-bar";
import { ProjectSidebar } from "@/components/crm/project-sidebar";
import { AccountList } from "@/components/crm/account-list";
import { AccountDetail } from "@/components/crm/account-detail";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

export function CrmApp() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null
  );
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  const loadProjects = useCallback(() => {
    fetch("/api/projects")
      .then(async (r) => {
        if (!r.ok) throw new Error(`Couldn't load projects (${r.status}).`);
        return (await r.json()) as Project[];
      })
      .then((data) => {
        setProjects(data);
        setSelectedProjectId((current) => current ?? data[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        // Without this branch a rejection leaves "Loading…" on screen forever,
        // and every CRUD route returns an HTML 500 that makes r.json() throw.
        setProjectsError(
          err instanceof Error ? err.message : "Couldn't load projects."
        );
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  function retryProjects() {
    setLoading(true);
    setProjectsError(null);
    loadProjects();
  }

  // Generation guard: a slow response for project A must never land after a fast
  // one for project B, or the list shows A's accounts under B's header and any
  // edit then persists against the wrong project.
  const accountsRequestId = useRef(0);

  const loadAccounts = useCallback((projectId: string) => {
    const generation = ++accountsRequestId.current;
    const controller = new AbortController();

    setAccountsError(null);
    fetch(`/api/accounts?projectId=${projectId}`, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Couldn't load accounts (${r.status}).`);
        return (await r.json()) as Account[];
      })
      .then((data) => {
        if (generation === accountsRequestId.current) setAccounts(data);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (generation !== accountsRequestId.current) return;
        // Clear rather than keep: stale rows under a new header are worse than none.
        setAccounts([]);
        setAccountsError(
          err instanceof Error ? err.message : "Couldn't load accounts."
        );
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      accountsRequestId.current++; // invalidate anything still in flight
      setAccounts([]);
      setAccountsError(null);
      return;
    }
    setSelectedAccountId(null);
    return loadAccounts(selectedProjectId);
  }, [selectedProjectId, loadAccounts]);

  const selectedProject =
    projects.find((p) => p.id === selectedProjectId) ?? null;
  const selectedAccount =
    accounts.find((a) => a.id === selectedAccountId) ?? null;

  function handleAccountUpdated(updated: Account) {
    const previous = accounts.find((a) => a.id === updated.id);
    const movedProject = !!previous && previous.projectId !== updated.projectId;

    setAccounts((prev) =>
      movedProject
        ? prev.filter((a) => a.id !== updated.id)
        : prev.map((a) => (a.id === updated.id ? updated : a))
    );

    if (!previous || !movedProject) return;

    // It no longer belongs to the open project — drop the selection so the detail
    // pane can't keep editing a contact that has left this list.
    setSelectedAccountId((current) =>
      current === updated.id ? null : current
    );

    // Sidebar counts are maintained by hand in two places (see CLAUDE.md); a move
    // has to decrement the old project and increment the new one.
    setProjects((prev) =>
      prev.map((p) => {
        if (p.id === previous.projectId) {
          return {
            ...p,
            _count: { accounts: Math.max(0, (p._count?.accounts ?? 0) - 1) },
          };
        }
        if (p.id === updated.projectId) {
          return { ...p, _count: { accounts: (p._count?.accounts ?? 0) + 1 } };
        }
        return p;
      })
    );
  }

  function handleAccountCreated(created: Account) {
    setAccounts((prev) => [...prev, created]);
    setSelectedAccountId(created.id);
    setProjects((prev) =>
      prev.map((p) =>
        p.id === created.projectId
          ? { ...p, _count: { accounts: (p._count?.accounts ?? 0) + 1 } }
          : p
      )
    );
  }

  function handleProjectCreated(created: Project) {
    setProjects((prev) => [...prev, created]);
    setSelectedProjectId(created.id);
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (projectsError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">{projectsError}</p>
        <Button variant="outline" size="sm" onClick={retryProjects}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="min-h-0 flex-1">
        <ResizablePanelGroup orientation="horizontal">
          <ResizablePanel defaultSize="18" minSize="14" maxSize="28">
            <ProjectSidebar
              projects={projects}
              selectedProjectId={selectedProjectId}
              onSelect={setSelectedProjectId}
              onCreated={handleProjectCreated}
            />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="28" minSize="22" maxSize="40">
            <AccountList
              project={selectedProject}
              accounts={accounts}
              selectedAccountId={selectedAccountId}
              error={accountsError}
              onRetry={() =>
                selectedProjectId && loadAccounts(selectedProjectId)
              }
              onSelect={setSelectedAccountId}
              onCreated={handleAccountCreated}
            />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="54">
            <AccountDetail
              account={selectedAccount}
              project={selectedProject}
              projects={projects}
              onUpdated={handleAccountUpdated}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
