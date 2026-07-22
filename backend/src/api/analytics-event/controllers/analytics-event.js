'use strict';

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::analytics-event.analytics-event');
