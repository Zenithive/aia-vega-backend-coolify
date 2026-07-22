module.exports = ({ env }) => ({
  /**
   * Local admin plugin: Modules Sidebar
   */
  'modules-sidebar': {
    enabled: true,
    resolve: './src/plugins/modules-sidebar',
  },

  /**
   * Local plugin: Analytics Dashboard
   */
  'analytics-dashboard': {
    enabled: true,
    resolve: './src/plugins/analytics-dashboard',
  },

  /**
   * Local plugin: Audit Log
   */
  'audit-log': {
    enabled: true,
    resolve: './src/plugins/audit-log',
  },

  /**
   * Local plugin: Quiz Reattempt Requests
   */
  'quiz-reattempt-requests': {
    enabled: true,
    resolve: './src/plugins/quiz-reattempt-requests',
  },

  /**
   * Local plugin: Profile Edit Requests
   */
  'profile-edit-requests': {
    enabled: true,
    resolve: './src/plugins/profile-edit-requests',
  },

  /**
   * Local plugin: Quiz Submission
   */
  'quiz-submission-admin': {
    enabled: true,
    resolve: './src/plugins/quiz-submission-admin',
  },

  /**
   * Local plugin: Feedback Submission
   */
  'feedback-submission-admin': {
    enabled: true,
    resolve: './src/plugins/feedback-submission-admin',
  },

  /**
   * 📧 Email Provider (Nodemailer)
   */
  email: {
    enabled: env.bool('EMAIL_ENABLED', false),
    config: {
      provider: 'nodemailer',
      providerOptions: {
        host: env('SMTP_HOST', 'smtp.gmail.com'),
        port: env.int('SMTP_PORT', 587),
        secure: env.bool('SMTP_SECURE', false),
        ...(env('SMTP_USERNAME') && env('SMTP_PASSWORD')
          ? {
              auth: {
                user: String(env('SMTP_USERNAME')).trim(),
                pass: String(env('SMTP_PASSWORD')).trim(),
              },
            }
          : {}),
      },
      settings: {
        defaultFrom: env('EMAIL_FROM', 'noreply@example.com'),
        defaultReplyTo: env('EMAIL_REPLY_TO', 'noreply@example.com'),
      },
    },
  },

  /**
   * 🚀 Upload Plugin configuration
   */
  upload: {
    config: {
      providerOptions: {
        localServer: {
          maxage: 300000
        },
      },
      sizeLimit: 2560 * 1024 * 1024, // 2.5GB limit in bytes
    },
  },

  /**
   * 🔌 IO Plugin (WebSockets / Realtime)
   */
  io: {
    enabled: true,
    config: {
      contentTypes: ['api::quiz-submission.quiz-submission'],
      socketIO: {
        cors: {
          origin: '*',
        },
      },
    },
  },
});