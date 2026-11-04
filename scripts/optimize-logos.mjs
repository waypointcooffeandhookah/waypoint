// Logo varyantlarını üretir (tek seferlik; çıktılar public/ altında commit edilir).
// logo-balanced.png 1254px / 1.6 MB idi ve en fazla 132px gösteriliyordu.
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const src = fileURLToPath(new URL('../public/logo-balanced.png', import.meta.url))
const out = name => fileURLToPath(new URL(`../public/${name}`, import.meta.url))
const jobs = [
  ['logo-mark-320.webp', img => img.resize(320, 320).webp({ quality: 88, effort: 6 })], // ekran içi (≤132px @3x ≈ 400 → 320 yeterli)
  ['logo-mark-144.webp', img => img.resize(144, 144).webp({ quality: 90, effort: 6 })], // başlık (40–44px @3x)
  ['favicon-64.png', img => img.resize(64, 64).png({ compressionLevel: 9, palette: true })],
  ['apple-touch-icon.png', img => img.resize(180, 180).png({ compressionLevel: 9 })],
  ['icon-192.png', img => img.resize(192, 192).png({ compressionLevel: 9 })],
  ['icon-512.png', img => img.resize(512, 512).png({ compressionLevel: 9, palette: true, quality: 90 })],
]
for (const [name, make] of jobs) {
  const info = await make(sharp(src)).toFile(out(name))
  console.log(`${name}: ${Math.round(info.size / 1024)} KB`)
}
