import { useEffect, useRef, useState } from 'react'
import { startOrderSync } from './orderSync.js'

export function useOrderSync(backend, load, pollMs) {
  const [connection, setConnection] = useState('connecting')
  const sync = useRef(null)

  useEffect(() => {
    sync.current = startOrderSync({ subscribe: backend.subscribe, refresh: load, onConnection: setConnection, pollMs })
    return () => sync.current.stop()
  }, [backend, load, pollMs])

  return { connection, refresh: () => sync.current?.refresh() }
}
