'use strict';

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::analytics-event.analytics-event');
