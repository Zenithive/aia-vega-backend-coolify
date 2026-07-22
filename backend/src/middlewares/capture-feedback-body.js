'use strict';

const { Readable } = require('stream');

module.exports = (config, { strapi }) => {
  return async (ctx, next) => {
    const path = (ctx.path || ctx.request?.path || '').toLowerCase();
    const isFeedbackSubmit =
      path.includes('feedback-submission') && path.endsWith('/submit');
    const isQuizReattempt =
      path.includes('quiz-reattempt-request');

    const shouldCapture = ctx.method === 'POST' && (isFeedbackSubmit || isQuizReattempt);

    if (shouldCapture) {
      try {
        const chunks = [];
        await new Promise((resolve, reject) => {
          ctx.req.on('data', (chunk) => chunks.push(chunk));
          ctx.req.on('end', resolve);
          ctx.req.on('error', reject);
        });
        const buffer = Buffer.concat(chunks);
        const raw = buffer.toString('utf8');

        // Strapi uses Pino — second arg must be an object (metadata), not printf args.
        strapi.log.info({ path: ctx.path, method: ctx.method, rawLength: raw.length }, '[capture-body] captured');

        if (raw && raw.trim()) {
          const parsed = JSON.parse(raw);
          if (isFeedbackSubmit) ctx.state.feedbackBody = parsed;
          if (isQuizReattempt) {
            ctx.state.quizReattemptBody = parsed;
            strapi.log.info({ path: ctx.path, keys: Object.keys(parsed) }, '[capture-body] quizReattemptBody set');
          }
        } else {
          strapi.log.warn({ path: ctx.path }, '[capture-body] empty raw body');
        }

        // Replace consumed stream so body parser can still read it
        const newStream = Readable.from([buffer]);
        const orig = ctx.req;
        newStream.headers = orig.headers;
        newStream.method = orig.method;
        newStream.url = orig.url;
        ctx.req = newStream;
      } catch (err) {
        strapi.log.warn({ path: ctx.path, err: err?.message }, '[capture-body] parse failed');
      }
    }

    await next();
  };
};
