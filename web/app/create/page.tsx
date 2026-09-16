import { CreateForm } from "@/components/CreateForm";

export default function CreatePage() {
  return (
    <main>
      <section className="hero">
        <h1>Launch a token</h1>
        <p>One transaction on Arc Mainnet. You get a toast as soon as the factory emits Launched.</p>
      </section>
      <CreateForm />
    </main>
  );
}
