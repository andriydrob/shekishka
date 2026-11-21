import type { PublicRoom } from './game/room'

export interface Creds { seat: number; token: string }
export interface ApiResult { room?: PublicRoom; error?: string; seat?: number; token?: string }

export async function api(body: object | null, id?: string): Promise<ApiResult> {
  try {
    const res = body
      ? await fetch('/api/room', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      : await fetch(`/api/room?id=${encodeURIComponent(id ?? '')}`)
    return await res.json()
  } catch {
    return { error: 'Немає зв’язку з сервером' }
  }
}

// Місце в кімнаті пам'ятаємо в браузері, щоб після оновлення сторінки повернутися на нього.
const key = (id: string) => `shekishka:room:${id}`
export function loadCreds(id: string): Creds | null {
  try {
    return JSON.parse(localStorage.getItem(key(id)) ?? 'null')
  } catch {
    return null
  }
}
export function saveCreds(id: string, c: Creds) {
  try {
    localStorage.setItem(key(id), JSON.stringify(c))
  } catch { /* приватний режим: після оновлення сторінки місце не відновиться */ }
}
