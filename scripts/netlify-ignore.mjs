// Netlify "ignore" komutu: çıkış 0 = derlemeyi ATLA (yayın oluşmaz), 1 = derle.
// Yalnızca feature/restaurant-pos production yayını derlenir; PR önizlemeleri ve diğer dallar atlanır.
import { netlifyShouldBuild } from './staging-build.lib.mjs'

const decision = netlifyShouldBuild(process.env)
console.log(`${decision.build ? 'Derleniyor' : 'Atlandı'}: ${decision.reason}`)
process.exit(decision.build ? 1 : 0)
