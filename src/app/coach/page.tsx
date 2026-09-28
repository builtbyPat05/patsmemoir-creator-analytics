import { CoachConversation } from "@/components/dashboard/coach-conversation";
import { Sidebar } from "@/components/dashboard/sidebar";

export default function CoachPage() {
  return (
    <main className="app-shell">
      <Sidebar activeSection="coach" />
      <section className="main-content coach-page-content">
        <CoachConversation />
      </section>
    </main>
  );
}
