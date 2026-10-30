// İsteğe bağlı yeni sipariş sesi. Tarayıcılar sesi ancak bir dokunuştan sonra açar; bu yüzden
// unlock() kullanıcı etkileşiminde çağrılır. Dosya gerektirmez, Web Audio ile üretilir.
const PREF_KEY = 'waypoint-kitchen-sound'

export const readSoundPref = () => { try { return localStorage.getItem(PREF_KEY) === '1' } catch { return false } }
export function writeSoundPref(value) {
  try { localStorage.setItem(PREF_KEY, value ? '1' : '0') } catch { /* Depolama kapalı olabilir. */ }
}

export function createChime() {
  let context = null
  return {
    unlock() {
      const AudioContextClass = window.AudioContext ?? window.webkitAudioContext
      if (!AudioContextClass) return
      context ??= new AudioContextClass()
      context.resume?.()
    },
    play() {
      if (context?.state !== 'running') return
      ;[880, 1175].forEach((frequency, index) => {
        const start = context.currentTime + index * 0.18
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        oscillator.frequency.value = frequency
        gain.gain.setValueAtTime(0.0001, start)
        gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3)
        oscillator.connect(gain).connect(context.destination)
        oscillator.start(start)
        oscillator.stop(start + 0.32)
      })
    },
  }
}
