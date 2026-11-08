'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import ShareVerdict from '@/components/share-verdict'
import type { ShareCopy } from '@/lib/share'

// The verdict card's share trigger. Opens the share sheet, which owns the
// preview, the channels, and the visibility controls.
//
// Everything here is from the VIEWER's perspective, not the debate owner's.
// In a ranked online match the person looking at this screen is just as often
// the guest, and "I beat them 81-62" prefilled into their group chat when they
// actually lost is the kind of thing that gets an app closed for good.

type Props = {
  debateId: string
  /** The viewer's own score. */
  score: number
  opponentScore: number
  /** "the AI", or the other player's name. */
  opponentName: string
  outcome: ShareCopy['outcome']
  /** False for a seat that did not create the debate: they can send it, not change it. */
  canManage?: boolean
  initialReceipts?: boolean
  initialName?: boolean
  initialRevoked?: boolean
  /** Primary by default. The verdict's out-of-tickets card demotes it. */
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'md' | 'lg'
  className?: string
}

export default function ShareVerdictButton({
  debateId,
  score,
  opponentScore,
  opponentName,
  outcome,
  canManage = true,
  initialReceipts = true,
  initialName = true,
  initialRevoked = false,
  variant = 'primary',
  size = 'md',
  className,
}: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        onClick={() => setOpen(true)}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          aria-hidden
        >
          <circle cx="18" cy="5" r="3" />
          <circle cx="6" cy="12" r="3" />
          <circle cx="18" cy="19" r="3" />
          <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" strokeLinecap="round" />
        </svg>
        SHARE THE VERDICT
      </Button>

      <ShareVerdict
        open={open}
        onClose={() => setOpen(false)}
        debateId={debateId}
        copy={{ score, opponentScore, opponentName, outcome }}
        canManage={canManage}
        initialReceipts={initialReceipts}
        initialName={initialName}
        initialRevoked={initialRevoked}
      />
    </>
  )
}
