// reusable loading skeletons for the landing + dashboard pages
// keeps the shape of the real content so the layout doesn't jump on load

// one shimmer block you can drop anywhere
export function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-xl bg-ink-100 dark:bg-ink-700 ${className}`}
    />
  );
}

// a full skeleton of the dashboard main grid
export function DashboardSkeleton() {
  return (
    <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <SkeletonBlock className="h-32" />
        <div className="grid grid-cols-3 gap-4">
          <SkeletonBlock className="h-28" />
          <SkeletonBlock className="h-28" />
          <SkeletonBlock className="h-28" />
        </div>
        <div className="grid grid-cols-2 gap-6">
          <SkeletonBlock className="h-48" />
          <SkeletonBlock className="h-48" />
        </div>
      </div>
      <SkeletonBlock className="h-[560px]" />
    </div>
  );
}

// a smaller skeleton for the recent sites list
export function RecentSitesSkeleton() {
  return (
    <div className="mt-16 w-full max-w-xl space-y-2">
      <SkeletonBlock className="h-4 w-40" />
      <SkeletonBlock className="h-12" />
      <SkeletonBlock className="h-12" />
    </div>
  );
}
