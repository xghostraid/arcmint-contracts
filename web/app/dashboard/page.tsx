import { CreatorTokens } from "@/components/CreatorTokens";
import { loadCatalog } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardPage() {
  const catalog = await loadCatalog(true);
  return (
    <main>
      <section className="hero">
        <h1>Your hub</h1>
        <p>Tokens you created on this factory. New launches show up here as soon as the tx lands.</p>
      </section>
      <CreatorTokens tokens={catalog.tokens} />
    </main>
  );
}
