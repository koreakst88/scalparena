import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const BYBIT_BASE = 'https://api.bytick.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const path = url.searchParams.get('path');
    const params = url.searchParams.get('params');

    if (!path) {
      return new Response(JSON.stringify({ error: 'Missing path parameter' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const bybitUrl = `${BYBIT_BASE}${path}${params ? `?${params}` : ''}`;
    console.log('Proxying to:', bybitUrl);

    const response = await fetch(bybitUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
    });

    const text = await response.text();
    console.log('Response status:', response.status);
    console.log('Response preview:', text.substring(0, 100));

    if (text.startsWith('<') || text.startsWith('<!')) {
      console.error('Got HTML instead of JSON - blocked by Cloudflare');
      return new Response(
        JSON.stringify({ error: 'Blocked by CDN', raw: text.substring(0, 200) }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = JSON.parse(text);

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Proxy error:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
