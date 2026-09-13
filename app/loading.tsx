export default function Loading() {
  return (
    <main className="page-container loading-page" aria-label="Loading Petalcards">
      <div className="loading-title" />
      <div className="loading-subtitle" />
      <div className="loading-grid">
        {[0, 1, 2].map((item) => <div key={item} className="loading-card" />)}
      </div>
    </main>
  );
}
