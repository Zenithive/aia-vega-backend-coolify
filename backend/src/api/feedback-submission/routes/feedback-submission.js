'use strict';

/**
 * feedback-submission router
 */


module.exports = {
	routes: [
		{
			method: 'POST',
			path: '/feedback-submission/submit',
			handler: 'api::feedback-submission.feedback-submission.submit',
			config: {
				auth: false,
				policies: [],
				middlewares: [],
			},
		},
		// Default CRUD routes
		{
			method: 'GET',
			path: '/feedback-submission',
			handler: 'feedback-submission.find',
			config: {
				policies: [],
				middlewares: [],
			},
		},
		{
			method: 'POST',
			path: '/feedback-submission',
			handler: 'feedback-submission.create',
			config: {
				policies: [],
				middlewares: [],
			},
		},
		// ...other default routes as needed
	],
};
