"use client";

import { useEffect, useState } from "react";
import { Account, Project } from "@/lib/types";
import { TopBar } from "@/components/crm/top-bar";
import { ProjectSidebar } from "@/components/crm/project-sidebar";
import { AccountList } from "@/components/crm/account-list";
import { AccountDetail } from "@/components/crm/account-detail";
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

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data: Project[]) => {
        setProjects(data);
        if (data.length > 0) setSelectedProjectId(data[0].id);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setAccounts([]);
      return;
    }
    setSelectedAccountId(null);
    fetch(`/api/accounts?projectId=${selectedProjectId}`)
      .then((r) => r.json())
      .then((data: Account[]) => setAccounts(data));
  }, [selectedProjectId]);

  const selectedProject =
    projects.find((p) => p.id === selectedProjectId) ?? null;
  const selectedAccount =
    accounts.find((a) => a.id === selectedAccountId) ?? null;

  function handleAccountUpdated(updated: Account) {
    setAccounts((prev) =>
      prev.map((a) => (a.id === updated.id ? updated : a))
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
              onSelect={setSelectedAccountId}
              onCreated={handleAccountCreated}
            />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize="54">
            <AccountDetail
              account={selectedAccount}
              project={selectedProject}
              onUpdated={handleAccountUpdated}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
}
