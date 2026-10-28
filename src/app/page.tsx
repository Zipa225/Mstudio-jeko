// Page provisoire du socle. L'écran marchand la remplacera (feature/ecran-marchand).
export default function Home() {
  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "24px 16px" }}>
      <section className="carte">
        <h1 style={{ margin: 0, color: "var(--jeko-violet-profond)", fontSize: 28, fontWeight: 600 }}>Jèko Voix</h1>
        <p style={{ color: "var(--texte-doux)", margin: "8px 0 0" }}>Prototype hackathon M.Studio x AethexAI.</p>
      </section>
    </main>
  );
}
