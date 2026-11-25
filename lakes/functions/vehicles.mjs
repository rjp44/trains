import { createVehicleFeed } from '../feeds.mjs';
import { readBusArchive } from '../bus-archive.mjs';

const snapshot = createVehicleFeed(readBusArchive);
export default async function vehicles(request) {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } });
  const data = await snapshot();
  return Response.json(data, {
    headers: {
      'Cache-Control': 'no-store',
      'Netlify-CDN-Cache-Control':
        data.bus.ok && data.rail.ok ? 'public, durable, max-age=30' : 'public, max-age=5',
    },
  });
}
export const config = { path: '/api/vehicles' };
