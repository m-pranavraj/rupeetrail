export interface RealtimeTicket {
  ticket: string
  expiresAt: number
  websocketUrl: string
}

export function createRealtimeTicket(
  env: unknown,
  options: {
    room: string
    userId: string
    origin: string
    publish?: boolean
    presence?: boolean
  },
): Promise<RealtimeTicket>

export function publishRealtime(
  env: unknown,
  options: { room: string; event: string; data: unknown },
): Promise<void>
