"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="page-container fatal-state">
      <p className="eyebrow">Something went wrong</p>
      <h1>Petalcards lost its place.</h1>
      <p>Your saved cards have not been changed. Please try loading the page again.</p>
      <Button className="primary-button" onClick={reset}>Try again</Button>
    </main>
  );
}
