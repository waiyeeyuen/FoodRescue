export default function RestaurantPayouts() {
  return (
    <div className="flex flex-col gap-6">
      <section className="spotlight-panel overflow-hidden rounded-[34px] p-6 sm:p-8">
        <span className="hero-kicker">Payout Flow</span>
        <h1 className="hero-title mt-4 text-4xl text-slate-900 sm:text-5xl">
          Recovery revenue deserves a better dashboard too.
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
          This space can show settled payouts, pending pickup revenue, and the value recovered from
          food that would otherwise go unsold.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          { label: 'Pending payout', value: 'SGD 0.00' },
          { label: 'Recovered this week', value: 'SGD 0.00' },
          { label: 'Next transfer window', value: 'TBD' },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-[28px] border border-white/70 bg-white/78 p-5 shadow-[0_20px_40px_-30px_rgba(24,36,33,0.45)]"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              {card.label}
            </p>
            <p className="mt-3 text-3xl font-semibold text-slate-900">{card.value}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
