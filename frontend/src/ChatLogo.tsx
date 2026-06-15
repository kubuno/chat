interface ChatLogoProps {
  size?:      number
  className?: string
  title?:     string
}

/** Logo Chat : carré arrondi bleu + deux bulles de discussion qui se font face. */
export function ChatLogo({ size = 24, className, title = 'Chat' }: ChatLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      role="img"
      aria-label={title}
      className={className}
    >
      <title>{title}</title>
      <rect width="512" height="512" rx="114" fill="#0EA5E9" />
      <rect x="72" y="132" width="150" height="116" rx="34" fill="#FFFFFF" />
      <polygon points="110,244 110,294 152,248" fill="#FFFFFF" />
      <rect x="290" y="204" width="150" height="116" rx="34" fill="#BAE6FD" />
      <polygon points="402,316 402,366 360,320" fill="#BAE6FD" />
    </svg>
  )
}

export default ChatLogo
