// One compact page header for the hub's sub-screens, replacing four
// near-identical poster heroes that ran roughly 320px each before any content
// appeared. About 110px now.
//
// The `stat` slot is not decorative and it is not optional in spirit: it is the
// thing that earns the header its space. The old heroes spent 320px repeating a
// slogan the user had already read, and pushed the leaderboard's actual board
// below the fold on a laptop. A live number does not do that.

export default function PageHeader({
  eyebrow,
  title,
  stat,
}: {
  eyebrow: string
  title: React.ReactNode
  stat?: React.ReactNode
}) {
  return (
    <div className="reveal r1 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-5">
      <div>
        <p className="font-mono text-[11px] font-bold tracking-[0.3em] text-blaze-bright">
          {eyebrow}
        </p>
        <h1 className="mt-2 font-athletic text-2xl font-black uppercase tracking-tight md:text-3xl">
          {title}
        </h1>
      </div>
      {stat && (
        <p className="font-mono text-[11px] tracking-[0.25em] text-chalk-3">{stat}</p>
      )}
    </div>
  )
}
