import React from 'react'


// ── Control-bar pieces ────────────────────────────────────────────────────────

/** A round control-bar button. `plain` keeps it flat (side panels). */
export function CtrlButton({ children, onClick, title, active, danger, plain }: {
  children: React.ReactNode; onClick: (e: React.MouseEvent) => void; title: string
  active?: boolean; danger?: boolean; plain?: boolean
}) {
  const tone = danger ? 'bg-red-600 hover:bg-red-700 text-white'
    : active ? 'bg-primary text-white hover:opacity-90'
    : plain ? 'text-gray-200 hover:bg-white/10'
    : 'bg-white/10 text-white hover:bg-white/20'
  return (
    <button onClick={e => onClick(e)} title={title} className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${tone}`}>
      {children}
    </button>
  )
}


export function StageButton({ children, title, onClick, disabled, active }: {
  children: React.ReactNode; title: string; onClick: (e: React.MouseEvent) => void
  disabled?: boolean; active?: boolean
}) {
  return (
    <button
      onClick={e => onClick(e)}
      title={title}
      disabled={disabled}
      className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${active ? 'bg-white/25 text-white' : 'text-white hover:bg-white/15'} disabled:opacity-40 disabled:hover:bg-transparent`}
    >
      {children}
    </button>
  )
}
