// Garson/müşteri sepeti. Fiyat yalnızca tahmini gösterim içindir; sunucu yeniden hesaplar.
export const MAX_QUANTITY = 20
export const MAX_LINES = 30

export const emptyCart = Object.freeze({ lines: [], note: '' })

const clampQuantity = quantity => Math.max(0, Math.min(MAX_QUANTITY, Math.trunc(quantity) || 0))

export function cartReducer(state, action) {
  switch (action.type) {
    case 'add': {
      const { item } = action
      const plain = state.lines.find(line => line.menuItemId === item.id && !line.note)
      if (plain) {
        return { ...state, lines: state.lines.map(line => line === plain ? { ...line, quantity: clampQuantity(line.quantity + 1) } : line) }
      }
      if (state.lines.length >= MAX_LINES) return state
      const line = { lineId: action.lineId ?? crypto.randomUUID(), menuItemId: item.id, name: item.name, price: item.price, image: item.image ?? null, quantity: 1, note: '' }
      return { ...state, lines: [...state.lines, line] }
    }
    case 'setQuantity': {
      const quantity = clampQuantity(action.quantity)
      return {
        ...state,
        lines: quantity === 0
          ? state.lines.filter(line => line.lineId !== action.lineId)
          : state.lines.map(line => line.lineId === action.lineId ? { ...line, quantity } : line),
      }
    }
    case 'setLineNote':
      return { ...state, lines: state.lines.map(line => line.lineId === action.lineId ? { ...line, note: action.note.slice(0, 200) } : line) }
    case 'setNote':
      return { ...state, note: action.note.slice(0, 300) }
    case 'clear':
      return emptyCart
    default:
      return state
  }
}

export const cartCount = cart => cart.lines.reduce((sum, line) => sum + line.quantity, 0)

export const quantityOf = (cart, menuItemId) =>
  cart.lines.reduce((sum, line) => sum + (line.menuItemId === menuItemId ? line.quantity : 0), 0)

export const toOrderPayloadLines = cart =>
  cart.lines.map(({ menuItemId, quantity, note }) => ({ menuItemId, quantity, note: note.trim() || null }))
