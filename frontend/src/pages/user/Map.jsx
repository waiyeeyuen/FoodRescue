export default function UserMap() {
  return (
    <div className="flex flex-col gap-6">
      <section className="spotlight-panel overflow-hidden rounded-[34px] p-6 sm:p-8">
        <span className="hero-kicker">Map Discovery</span>
        <h1 className="hero-title mt-4 text-4xl text-slate-900 sm:text-5xl">
          Find nearby rescues by place, not just by list.
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
          This page is ready for nearby restaurants, pickup windows, and distance-based browsing
          once the live map layer is connected.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          'Closest rescue kitchens',
          'Pickup windows happening soon',
          'Neighbourhoods with the most live listings',
        ].map((item) => (
          <div
            key={item}
            className="rounded-[28px] border border-white/70 bg-white/78 p-5 shadow-[0_20px_40px_-30px_rgba(24,36,33,0.45)]"
          >
            <p className="text-lg font-semibold text-slate-900">{item}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
