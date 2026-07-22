const allowedCorsOrigins = String(process.env['ALLOWED_CORS_ORIGINS'] || 'http://localhost:3000')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

module.exports = [
  'global::ensure-department-after-user',
  'global::ensure-work-location-after-user',
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  {
    name: 'strapi::cors',
    config: {
      origin: allowedCorsOrigins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
      headers: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
      keepHeaderOnError: true,
    },
  },
  'strapi::poweredBy',
  'strapi::query',
  'global::capture-feedback-body',
  {
    name: 'strapi::body',
    config: {
      formLimit: '2560mb', // modify form body
      jsonLimit: '2560mb', // modify JSON body
      textLimit: '2560mb', // modify text body
      formidable: {
        maxFileSize: 2560 * 1024 * 1024, // multipart data, 2.5GB limit
      },
    },
  },
  'strapi::session',
  {
    name: 'strapi::favicon',
    config: {
      path: './public/favicon.png',
    },
  },
  'strapi::public',
];
