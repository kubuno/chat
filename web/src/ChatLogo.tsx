interface ChatLogoProps {
  size?:      number
  className?: string
  title?:     string
}

/** Chat logo (designer artwork, raster). Served by the host from
 *  `/chat-logo.png`; rendered as a square image so it weighs the same as its
 *  neighbours in the waffle menu. */
export function ChatLogo({ size = 24, className, title = 'Chat' }: ChatLogoProps) {
  return (
    <img
      src="/chat-logo.png"
      width={size}
      height={size}
      alt={title}
      className={className}
      style={{ display: 'block', objectFit: 'contain' }}
    />
  )
}

export default ChatLogo
