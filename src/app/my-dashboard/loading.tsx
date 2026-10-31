// What My Dashboard shows while its data loads: the same shapes, so nothing jumps
const block = 'rounded-xl bg-secondary animate-pulse';

export default function MyDashboardLoading() {
  return (
    <div aria-busy="true" className="pb-20">
      <div className="border-b border-border">
        <div className="mx-auto grid max-w-7xl items-center gap-6 px-6 py-10 md:grid-cols-2 md:py-16">
          <div className={`mx-auto aspect-square w-full max-w-56 md:max-w-64 ${block}`} />
          <div className={`h-56 ${block}`} />
        </div>
      </div>
      <div className="mx-auto max-w-7xl space-y-14 px-6 pt-10">
        <div className={`h-80 ${block}`} />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className={`h-44 ${block}`} />)}
        </div>
        <div className={`h-96 ${block}`} />
      </div>
    </div>
  );
}
