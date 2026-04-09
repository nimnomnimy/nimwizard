import { avatarColor, initials } from '../../lib/utils'

interface Props {
  name: string
  size?: 'sm' | 'md' | 'lg'
}

const sizes = { sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-14 h-14 text-base' }

export default function ContactAvatar({ name, size = 'md' }: Props) {
  return (
    <div
      className={`${sizes[size]} rounded-full flex items-center justify-center font-bold text-white flex-shrink-0`}
      style={{ background: avatarColor(name) }}
    >
      {initials(name)}
    </div>
  )
}
