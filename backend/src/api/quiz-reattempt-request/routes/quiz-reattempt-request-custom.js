"use strict";

module.exports = {
  routes: [
    {
      method: "POST",
      path: "/quiz-reattempt-request/send",
      handler: "api::quiz-reattempt-request.quiz-reattempt-request.send",
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: "GET",
      path: "/quiz-reattempt-request/pending",
      handler: "api::quiz-reattempt-request.quiz-reattempt-request.checkPending",
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: "POST",
      path: "/quiz-reattempt-request/approve",
      handler: "api::quiz-reattempt-request.quiz-reattempt-request.approve",
      config: {
        auth: false,
        policies: [],
      },
    },
    {
      method: "POST",
      path: "/quiz-reattempt-request/reject",
      handler: "api::quiz-reattempt-request.quiz-reattempt-request.reject",
      config: {
        auth: false,
        policies: [],
      },
    },
  ],
};