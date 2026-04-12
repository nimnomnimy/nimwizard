import { useCallback, useState } from 'react'

interface Options {
  initial: number
  min?: number
  max?: number
}

/**
 * Returns [width, isOpen, dragHandleProps, toggleOpen]
 * Use dragHandleProps on the divider element.
 */
export function useResizable(opts: Options) {
  const { initial, min = 160, max = 600 } = opts
  const [width, setWidth]   = useState(initial)
  const [isOpen, setIsOpen] = useState(true)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    const onMove = (me: MouseEvent) => {
      const next = Math.max(min, Math.min(max, startW + me.clientX - startX))
      setWidth(next)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [width, min, max])

  return { width, isOpen, setIsOpen, dragHandleProps: { onMouseDown } }
}
