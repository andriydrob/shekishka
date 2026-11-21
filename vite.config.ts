import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// У `npm run dev` віддаємо /api/room тим самим обробником, що й Vercel Function (кімнати в пам'яті).
const devApi: Plugin = {
  name: 'dev-api',
  configureServer(server) {
    server.middlewares.use('/api/room', async (req, res) => {
      const mod = await server.ssrLoadModule('/api/room.ts')
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      const request = new Request(`http://localhost${req.originalUrl}`, {
        method: req.method,
        headers: { 'content-type': 'application/json' },
        body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
      })
      const handler = mod[req.method ?? 'GET']
      const response: Response = handler ? await handler(request) : new Response('Method not allowed', { status: 405 })
      res.statusCode = response.status
      res.setHeader('content-type', response.headers.get('content-type') ?? 'text/plain')
      res.end(await response.text())
    })
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), devApi],
})
