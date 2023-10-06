import { Router } from 'itty-router';

const router = Router();
const responseHeaders = new Headers({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
});

// Define a route for POST requests

router.post('/api/additem', async (request, env) => {
  const reqBody = await request.json();
  const key = `pending:${reqBody[0].intakeMethods}:${reqBody[0].orderId}`;
  await env.kindKV.put(key, JSON.stringify(reqBody));
  return new Response('Success', {
    status: 200,
    headers: responseHeaders,
  });
});

// Define a route for approving items with a specific orderId parameter
router.post('/api/approve/:orderId', async (request, env) => {
  const { orderId } = request.params;

  const response = await changeStatusAndHandleError(orderId, env);

  return response;
});

// Define a route for GET requests to get all pending items
router.get('/api/pending', async (request, env) => {
  const pending = await env.kindKV.list({ prefix: 'pending:' });
  const pendingItems = await Promise.all(
    pending.keys.map(async (key) => {
      const value = await env.kindKV.get(key.name);
      return { name: key.name, value };
    })
  );

  return new Response(JSON.stringify(pendingItems), {
    status: 200,
    headers: responseHeaders,
  });
});

router.get('/api/approvedpickup', async (request, env) => {
  const pending = await env.kindKV.list({ prefix: 'approved:pickup:' });
  const pendingItems = await Promise.all(
    pending.keys.map(async (key) => {
      const value = await env.kindKV.get(key.name);
      return { name: key.name, value };
    })
  );

  return new Response(JSON.stringify(pendingItems), {
    status: 200,
    headers: responseHeaders,
  });
});

// Define a route for other requests (OPTIONS)
router.all('*', (request) => {
  

  if (request.method === 'OPTIONS') {
    // Handle preflight request
    return new Response(null, {
      headers: responseHeaders,
    });
  } else {
    return new Response('Not Found', {
      status: 404,
      headers: responseHeaders,
    });
  }
});

export default {
  async fetch(request, env) {
    const allowed = ['kindapi.gusweb.workers.dev', 'kindapi.gusweb.dev'];
    const origin = new URL(request.url);

    if (!allowed.includes(origin.hostname)) {
      return new Response(`${origin.hostname} not allowed`, {
        status: 403,
      });
    }

    return router.handle(request, env);
  },
};


async function changeStatusAndHandleError(orderID, env) {
  const pendingKey = `pending:${orderID}`;
  const approvedKey = `approved:${orderID}`;

  try {
    // Get the values associated with the pending key
    const valuesJSON  = await env.kindKV.get(pendingKey);

    if (!valuesJSON ) {
      // If values are not found, return an error response
      return new Response('Item not found', {
        status: 404,
        headers: responseHeaders,
      });
    }

    const values = JSON.parse(valuesJSON);

    // Mapbox
    const address = values[0].clientInfo.address;

    const mapboxResponse = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${address}.json?types=address&access_token=${env.SECRET_KEY}`);

    if (!mapboxResponse.ok) {
      throw new Error(`Mapbox API error! status: ${mapboxResponse.status}`);
    }

    const mapboxData = await mapboxResponse.json();

    values[0].mapboxData = mapboxData.features[0].geometry.coordinates;

    const updatedValuesJSON = JSON.stringify(values);

    // Create a new key with the approved status and store the values
    await env.kindKV.put(approvedKey, updatedValuesJSON);

    // Delete the old key with the pending status
    await env.kindKV.delete(pendingKey);

    // Respond with a success message
    return new Response(`Item approved successfully ${values[0].mapboxData}`, {
      status: 200,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Error:', error);

    // Handle other errors, e.g., internal server error
    return new Response(`Internal Server Error`, {
      status: 500,
      headers: responseHeaders,
    });
  }
}