export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex max-w-md flex-col gap-2 px-6 text-center">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          Estima
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Service de valorisation immobilière. Pas d&apos;interface — consommé
          via API par Locatis et Patrimo.
        </p>
      </main>
    </div>
  );
}
