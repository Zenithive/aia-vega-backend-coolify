// @ts-nocheck
'use strict';

const { populateAnswerCorrectField } = require('../../../../utils/quiz-submission-correctness');

module.exports = {
  async beforeCreate(event) {
    try {
      const data = event.params?.data || {};
      await populateAnswerCorrectField(strapi, data);
      const t = Array.isArray(data.answers) ? data.answers.filter((a) => a?.correct === true).length : 0;
      const f = Array.isArray(data.answers) ? data.answers.filter((a) => a?.correct === false).length : 0;
      strapi.log.info('[quiz-submission lifecycle] beforeCreate total=%s true=%s false=%s', data?.answers?.length || 0, t, f);
    } catch (err) {
      strapi.log.warn('[quiz-submission lifecycle] beforeCreate correct compute failed', err);
    }
  },

  async beforeUpdate(event) {
    try {
      const data = event.params?.data || {};
      await populateAnswerCorrectField(strapi, data);
      const t = Array.isArray(data.answers) ? data.answers.filter((a) => a?.correct === true).length : 0;
      const f = Array.isArray(data.answers) ? data.answers.filter((a) => a?.correct === false).length : 0;
      strapi.log.info('[quiz-submission lifecycle] beforeUpdate total=%s true=%s false=%s', data?.answers?.length || 0, t, f);
    } catch (err) {
      strapi.log.warn('[quiz-submission lifecycle] beforeUpdate correct compute failed', err);
    }
  },
};

