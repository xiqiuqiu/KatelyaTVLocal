const MAINTENANCE_CRON = '0 3 * * *';

function buildCronTargetUrl(env) {
  const rawTarget =
    typeof env.CRON_TARGET_URL === 'string' ? env.CRON_TARGET_URL.trim() : '';

  if (!rawTarget) {
    throw new Error('Missing CRON_TARGET_URL');
  }

  if (rawTarget.endsWith('/api/cron')) {
    return rawTarget;
  }

  return `${rawTarget.replace(/\/+$/, '')}/api/cron`;
}

function buildCronHeaders(env) {
  const headers = new Headers({
    'user-agent': 'katelyatv-source-ranking-cron/1.0',
    'x-cron-trigger': 'cloudflare-worker',
  });

  if (typeof env.CRON_API_TOKEN === 'string' && env.CRON_API_TOKEN.trim()) {
    headers.set('x-cron-token', env.CRON_API_TOKEN.trim());
  }

  return headers;
}

async function triggerCron(env, triggerType, rankingOnly) {
  const target = new URL(buildCronTargetUrl(env));
  if (rankingOnly) target.searchParams.set('mode', 'ranking');
  const targetUrl = target.href;
  const response = await fetch(targetUrl, {
    method: 'GET',
    headers: buildCronHeaders(env),
  });
  const bodyText = await response.text();

  return {
    ok: response.ok,
    status: response.status,
    targetUrl,
    triggerType,
    bodyText,
  };
}

async function handleManualTrigger(env, triggerType, rankingOnly) {
  try {
    const result = await triggerCron(env, triggerType, rankingOnly);
    return new Response(
      JSON.stringify(
        {
          ok: result.ok,
          status: result.status,
          triggerType,
          targetUrl: result.targetUrl,
          body: result.bodyText,
        },
        null,
        2
      ),
      {
        status: result.ok ? 200 : 502,
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify(
        {
          ok: false,
          triggerType,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2
      ),
      {
        status: 500,
        headers: {
          'content-type': 'application/json; charset=utf-8',
        },
      }
    );
  }
}

const worker = {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(
        JSON.stringify(
          {
            ok: true,
            targetUrl: buildCronTargetUrl(env),
          },
          null,
          2
        ),
        {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
          },
        }
      );
    }

    return handleManualTrigger(
      env,
      'manual',
      url.searchParams.get('mode') === 'ranking'
    );
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      triggerCron(env, 'scheduled', controller.cron !== MAINTENANCE_CRON).then(
        (result) => {
          if (!result.ok) {
            throw new Error(
              `Cron trigger failed with ${result.status}: ${result.bodyText}`
            );
          }
        }
      )
    );
  },
};

export default worker;
