import { useEffect, useRef } from 'react'
import { turnstileSiteKey } from './turnstile-config'

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string
  reset: (widgetId: string) => void
  remove: (widgetId: string) => void
}

declare global {
  interface Window { turnstile?: TurnstileApi }
}

export function TurnstileChallenge({ onToken, resetKey }: { onToken: (token: string | null) => void; resetKey: number }) {
  const container = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)
  const callback = useRef(onToken)

  useEffect(() => { callback.current = onToken }, [onToken])

  useEffect(() => {
    if (!turnstileSiteKey) return
    let active = true
    const render = () => {
      if (!active || !container.current || !window.turnstile || widgetId.current) return
      widgetId.current = window.turnstile.render(container.current, {
        sitekey: turnstileSiteKey,
        callback: (token: string) => callback.current(token),
        'expired-callback': () => callback.current(null),
        'error-callback': () => callback.current(null)
      })
    }
    if (window.turnstile) render()
    else {
      let script = document.querySelector<HTMLScriptElement>('script[data-pawslink-turnstile]')
      if (!script) {
        script = document.createElement('script')
        script.dataset.pawslinkTurnstile = 'true'
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
        script.async = true
        document.head.appendChild(script)
      }
      script.addEventListener('load', render)
      return () => {
        active = false
        script.removeEventListener('load', render)
        if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current)
        widgetId.current = null
      }
    }
    return () => {
      active = false
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current)
      widgetId.current = null
    }
  }, [])

  useEffect(() => {
    if (resetKey && widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current)
  }, [resetKey])

  if (!turnstileSiteKey) return null
  return <div ref={container} aria-label="Bot protection challenge" />
}
