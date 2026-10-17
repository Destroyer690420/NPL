import { useEffect, useState } from 'react'

export interface PlayerAvatarProps {
  name: string
  photoUrl?: string | null
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  className?: string
}

const SIZE_CLASSES = {
  sm: 'size-8 text-xs rounded-lg',
  md: 'size-11 text-sm rounded-xl',
  lg: 'size-14 text-base rounded-2xl',
  xl: 'size-20 text-xl rounded-2xl',
  '2xl': 'size-32 sm:size-40 text-3xl sm:text-4xl rounded-3xl',
}

export function PlayerAvatar({
  name,
  photoUrl,
  size = 'md',
  className = '',
}: PlayerAvatarProps) {
  const [failed, setFailed] = useState(false)

  // Reset failure state whenever photoUrl changes
  useEffect(() => {
    setFailed(false)
  }, [photoUrl])

  const sizeClass = SIZE_CLASSES[size] ?? SIZE_CLASSES.md
  const cleanName = (name ?? '').trim()
  const initials = (cleanName.slice(0, 2) || '??').toUpperCase()

  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        alt={cleanName}
        onError={() => setFailed(true)}
        className={`${sizeClass} shrink-0 border border-line-strong bg-surface-muted object-cover shadow-sm ${className}`}
      />
    )
  }

  return (
    <span
      className={`flex ${sizeClass} shrink-0 items-center justify-center border border-line bg-surface-muted font-bold text-accent select-none ${className}`}
      aria-hidden="true"
    >
      {initials}
    </span>
  )
}
