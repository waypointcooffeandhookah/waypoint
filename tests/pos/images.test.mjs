import test from 'node:test'
import assert from 'node:assert/strict'
import { thumbUrl } from '../../src/utils/imageUtils.js'

const base = 'https://x.supabase.co/storage/v1/object/public/menu-images/uploads/ab12.webp'

test('kart görseli: yalnızca yeni WebP yüklemelerinin küçük sürümü kullanılır', () => {
  assert.equal(thumbUrl(base), base.replace('.webp', '.thumb.webp'))
  assert.equal(thumbUrl(base.replace('.webp', '.thumb.webp')), null, 'küçük sürümün küçüğü olmaz')
  assert.equal(thumbUrl(base.replace('.webp', '.jpg')), null, 'eski JPG yüklemeleri tam görselle kalır')
  assert.equal(thumbUrl('/images/waffle.jpg'), null)
  assert.equal(thumbUrl(null), null)
})
