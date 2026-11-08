'use client'

import { useRef } from 'react'
import { Check } from '@phosphor-icons/react/dist/ssr'

// The one option-group control. Eight groups across two screens were hand-rolled
// as bare <button>s, which had two problems.
//
// ACCESSIBILITY: no role, no grouping, no announced state. A screen reader read
// eight equal buttons with no indication that they were a choice, which one was
// taken, or what the choice was called. Now: a fieldset with a real legend, a
// radiogroup, aria-checked per option, roving tabindex (one tab stop for the
// group, arrows to move) and arrow-key selection, which is what a native radio
// group does and what people's fingers already expect.
//
// VISUAL: the selected state rested entirely on `border-blaze` over
// `bg-steel/30`, and that fill measures about 1.09:1 against ink, which is to
// say invisible. So on any screen that dims colour, or for the ~8% of men with
// a red deficiency, the selection was carried by a single hue at low contrast
// and nothing else. Selected now carries THREE independent signals: the border,
// a fill at a weight you can actually see, and a check glyph. Unselected cards
// move to border-line-strong so an unselected group reads as a set of controls
// rather than one undifferentiated block.

export type RadioOption<T extends string> = {
  value: T
  title: string
  /** Sentence-case label for the compact switch, e.g. "Same phone". */
  label?: string
  desc?: React.ReactNode
  /** Optional right-aligned note, e.g. a payout or a duration. */
  meta?: React.ReactNode
}

export function RadioCards<T extends string>({
  legend,
  hint,
  value,
  onChange,
  options,
  className = '',
  columns = 'sm:grid-cols-3',
  compact = false,
}: {
  legend: React.ReactNode
  hint?: React.ReactNode
  value: T
  onChange: (v: T) => void
  options: ReadonlyArray<RadioOption<T>>
  className?: string
  columns?: string
  /**
   * A one-row switch instead of a grid of cards, with the chosen option's
   * description underneath. For the new-debate page's "Change" panel, where
   * eleven full cards made the setup four and a half phone screens tall.
   * Same radiogroup semantics and keyboard behaviour; selection still carries
   * three signals (fill, ring, check).
   */
  compact?: boolean
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  // Arrow keys move the selection, wrapping at both ends, and move focus with
  // it. This is the behaviour of a native radio group; without it the roving
  // tabindex below would trap a keyboard user on one option.
  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']
    if (!keys.includes(e.key)) return
    e.preventDefault()
    const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown'
    const next = (i + (forward ? 1 : -1) + options.length) % options.length
    onChange(options[next].value)
    refs.current[next]?.focus()
  }

  if (compact) {
    const chosen = options.find((o) => o.value === value)
    return (
      <fieldset className={className}>
        <legend className="text-sm font-semibold text-chalk">{legend}</legend>
        {/* One row, every option the same width. No wrapping: four options
            at 375px used to drop the fourth onto a row of its own. */}
        <div
          role="radiogroup"
          className="mt-2.5 flex gap-1.5 rounded-card border border-line bg-ink/40 p-1.5"
        >
          {options.map((o, i) => {
            const selected = o.value === value
            return (
              <button
                key={o.value}
                ref={(el) => {
                  refs.current[i] = el
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => onChange(o.value)}
                onKeyDown={(e) => onKeyDown(e, i)}
                className={`inline-flex min-h-[44px] min-w-0 flex-1 basis-0 items-center justify-center gap-1.5 rounded-[11px] px-2 text-center text-sm font-semibold leading-tight transition-colors ${
                  selected
                    ? 'bg-steel text-chalk ring-1 ring-blaze'
                    : 'text-chalk-3 hover:bg-panel-hi hover:text-chalk'
                }`}
              >
                {selected && <Check size={12} weight="bold" aria-hidden className="text-blaze-bright" />}
                {o.label ?? o.title}
              </button>
            )
          })}
        </div>
        {(chosen?.desc || hint) && (
          <p className="mt-2 text-[13px] leading-relaxed text-chalk-3">
            {chosen?.desc}
            {chosen?.desc && hint ? ' ' : ''}
            {hint}
          </p>
        )}
      </fieldset>
    )
  }

  return (
    <fieldset className={className}>
      <legend className="font-mono text-[11px] font-bold tracking-[0.3em] text-chalk-3">
        {legend}
      </legend>
      {hint && <p className="mt-2 text-sm leading-relaxed text-chalk-3">{hint}</p>}

      <div role="radiogroup" className={`mt-4 grid gap-3 ${columns}`}>
        {options.map((o, i) => {
          const selected = o.value === value
          return (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              // Roving tabindex: the group is ONE tab stop, not eight.
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`press relative rounded-card border p-5 text-left transition-colors ${
                selected
                  ? 'border-blaze bg-steel/60'
                  : 'border-line-strong hover:border-blaze/50'
              }`}
            >
              {selected && (
                <span
                  aria-hidden
                  className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-blaze text-white"
                >
                  <Check size={12} weight="bold" />
                </span>
              )}
              <p className="pr-7 font-athletic text-lg font-black uppercase tracking-tight">
                {o.title}
              </p>
              {o.desc && <p className="mt-1 text-sm text-chalk-3">{o.desc}</p>}
              {o.meta && (
                <p className="mt-2 font-mono text-[10px] tracking-[0.2em] text-chalk-3">
                  {o.meta}
                </p>
              )}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
