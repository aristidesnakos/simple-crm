import { Suspense } from "react";
import { CrmApp } from "@/components/crm/crm-app";

export default function Home() {
  return (
    <div className="h-screen">
      {/* CrmApp reads ?project=&account= so the queue can deep-link into a contact;
          useSearchParams needs a Suspense boundary above it. */}
      <Suspense>
        <CrmApp />
      </Suspense>
    </div>
  );
}
