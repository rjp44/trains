import { createVehicleFeed } from '../feeds.mjs';
import { readBusArchive } from '../bus-archive.mjs';

const snapshot = createVehicleFeed(readBusArchive);
export default async function vehicles(request) {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } });
  const data = await snapshot();
  const legacy = new URL(request.url).pathname === '/api/vehicles';
  const rail = legacy ? { ...data.rail, vehicles: data.rail.vehicles.filter(v => v.route !== 'wcml') } : data.rail;
  return Response.json({ ...data, rail }, {
    headers: {
      'Cache-Control': 'no-store',
      'Netlify-CDN-Cache-Control':
        data.bus.ok && data.rail.ok ? 'public, durable, max-age=30' : 'public, max-age=5',
    },
  });
}
export const config = { path: ['/api/vehicles', '/api/lakes-vehicles'] };
