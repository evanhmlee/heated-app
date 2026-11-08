// Shaped like the deck, not a spinner. A skeleton that matches the real
// content's height stops the header and the first card from jumping once the
// server work lands.

export default function HubLoading() {
  return (
    <div aria-hidden className="animate-pulse">
      <div className="bezel h-[614px] lg:h-[464px]" />
      <div className="mt-12 h-[132px] rounded-card bg-panel" />
      <div className="mt-6 h-[132px] rounded-card bg-panel" />
    </div>
  )
}
