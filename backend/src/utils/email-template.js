// @ts-nocheck
'use strict';

const EMAIL_THEME = {
  PRIMARY: '#9C2EDB',
  PRIMARY_LIGHT: '#F4E2FF',
  DARK: '#080808',
  SUCCESS: '#22C55E',
  SUCCESS_LIGHT: '#F0FDF4',
  ERROR: '#EF4444',
  ERROR_LIGHT: '#FEE2E2',
  GRAY_BG: '#F3F4F6',
  GRAY_TEXT: '#585858',
  BODY_TEXT: '#1f1f1f',
};

function isEmailEnabled() {
  const raw = String(process.env.EMAIL_ENABLED || 'false').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildGreeting(userName) {
  const { BODY_TEXT } = EMAIL_THEME;
  const safeName = userName ? escapeHtml(userName) : null;
  return `<p style="font-size:15px;color:${BODY_TEXT};margin:0 0 14px;">Hello${safeName ? `, <strong>${safeName}</strong>` : ''},</p>`;
}

function buildCourseChip(courseTitle, accentColor, bgColor) {
  if (!courseTitle) return '';
  const { BODY_TEXT, GRAY_TEXT, DARK } = EMAIL_THEME;
  return `<div style="background:${bgColor};border-left:4px solid ${accentColor};border-radius:8px;padding:14px 18px;margin:20px 0;">
    <p style="margin:0;font-size:14px;color:${BODY_TEXT};"><span style="color:${GRAY_TEXT};font-size:12px;text-transform:uppercase;letter-spacing:.5px;font-weight:600;">Course</span></p>
    <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:${DARK};">${escapeHtml(courseTitle)}</p>
  </div>`;
}

function buildInfoBlock(label, value, accentColor, bgColor) {
  if (!value) return '';
  const { BODY_TEXT, GRAY_TEXT, DARK } = EMAIL_THEME;
  return `<div style="background:${bgColor};border-left:4px solid ${accentColor};border-radius:8px;padding:14px 18px;margin:20px 0;">
    <p style="margin:0;font-size:14px;color:${BODY_TEXT};"><span style="color:${GRAY_TEXT};font-size:12px;text-transform:uppercase;letter-spacing:.5px;font-weight:600;">${escapeHtml(label)}</span></p>
    <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:${DARK};">${escapeHtml(value)}</p>
  </div>`;
}

function wrapBrandedEmailHtml(title, bodyContent) {
  const { PRIMARY, DARK, GRAY_BG } = EMAIL_THEME;
  const safeTitle = escapeHtml(title);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${safeTitle}</title>
</head>
<body style="margin:0;padding:0;background:${GRAY_BG};font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${GRAY_BG};padding:40px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
        <tr>
          <td style="background:${DARK};padding:20px 32px;border-radius:12px 12px 0 0;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td>
                  <p style="margin:0;font-size:18px;font-weight:700;color:#ffffff;letter-spacing:1px;">AIA <span style="color:${PRIMARY};font-weight:300;">|</span> VEGA</p>
                  <p style="margin:2px 0 0;font-size:11px;color:#aaaaaa;letter-spacing:1.5px;text-transform:uppercase;">Learning Portal</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:${PRIMARY};padding:0;height:4px;"></td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:22px 32px 0;border-top:none;">
            <p style="margin:0;font-size:20px;font-weight:700;color:${DARK};">${safeTitle}</p>
            <div style="width:40px;height:3px;background:${PRIMARY};border-radius:2px;margin:8px 0 0;"></div>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:24px 32px 32px;">
            ${bodyContent}
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:18px 32px;border-top:1px solid #e5e7eb;border-radius:0 0 12px 12px;">
            <p style="margin:0;font-size:11px;color:#9ca3af;text-align:center;line-height:1.6;">
              This is an automated message from the <strong>AIA-VEGA Learning Portal</strong>.<br>
              Please do not reply to this email. For assistance, contact your HR or L&amp;D team.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildNotificationBodyContent(type, message, meta = {}) {
  const {
    PRIMARY,
    PRIMARY_LIGHT,
    SUCCESS,
    SUCCESS_LIGHT,
    ERROR,
    ERROR_LIGHT,
    GRAY_TEXT,
    BODY_TEXT,
  } = EMAIL_THEME;

  const courseTitle = meta.courseTitle || (meta.courseId ? `Course #${meta.courseId}` : null);
  const userName = meta.userName || null;
  const greeting = buildGreeting(userName);
  const courseChip = (accentColor, bgColor) => buildCourseChip(courseTitle, accentColor, bgColor);

  if (type === 'course_assigned') {
    return `
      ${greeting}
      <p style="font-size:15px;color:${BODY_TEXT};margin:0 0 10px;">
        A new course has been assigned to you on the <strong style="color:${PRIMARY};">AIA-VEGA Learning Portal</strong>.
      </p>
      <p style="font-size:14px;color:${GRAY_TEXT};margin:10px 0;">Please log in to the portal and begin your learning journey. Complete the course before the due date to stay on track with your development goals.</p>
      <p style="font-size:12px;color:${GRAY_TEXT};margin:0;">If you have any questions, please reach out to your Learning &amp; Development team.</p>
    `;
  }

  if (type === 'quiz_reattempt_approved') {
    return `
      ${greeting}
      <p style="font-size:15px;color:${BODY_TEXT};margin:0 0 10px;">
        Great news! Your quiz reattempt request has been <strong style="color:${SUCCESS};">approved</strong>.
      </p>
      ${courseChip(SUCCESS, SUCCESS_LIGHT)}
      <p style="font-size:14px;color:${GRAY_TEXT};margin:10px 0;">You can now log back in to the portal and reattempt the quiz. We recommend reviewing the course material thoroughly before your next attempt to improve your score.</p>
      <p style="font-size:12px;color:${GRAY_TEXT};margin:0;">Best of luck! If you need any support, please contact the Learning &amp; Development team.</p>
    `;
  }

  if (type === 'quiz_reattempt_rejected') {
    return `
      ${greeting}
      <p style="font-size:15px;color:${BODY_TEXT};margin:0 0 10px;">
        We regret to inform you that your quiz reattempt request has been <strong style="color:${ERROR};">rejected</strong>.
      </p>
      ${courseChip(ERROR, ERROR_LIGHT)}
      <p style="font-size:14px;color:${GRAY_TEXT};margin:10px 0;">If you believe this decision was made in error or would like further clarification, please reach out to your Learning &amp; Development team or your line manager.</p>
      <p style="font-size:13px;color:${GRAY_TEXT};margin:10px 0;">You may submit a new reattempt request after <strong>24 hours</strong> from the time of this notification.</p>
      <p style="font-size:12px;color:${GRAY_TEXT};margin:0;">We appreciate your commitment to learning and encourage you to continue your progress.</p>
    `;
  }

  if (type === 'course_unassigned') {
    return `
      ${greeting}
      <p style="font-size:15px;color:${BODY_TEXT};margin:0 0 10px;">
        Your enrollment for the following course on the <strong style="color:${PRIMARY};">AIA-VEGA Learning Portal</strong> has been updated.
      </p>
      ${courseChip(ERROR, ERROR_LIGHT)}
      <p style="font-size:14px;color:${GRAY_TEXT};margin:10px 0;">
        You are no longer eligible for this course. This may be due to a change in your assignment or training plan.
        If you believe this is an error or need further clarification, please reach out to your Learning &amp; Development team or your line manager.
      </p>
      <p style="font-size:12px;color:${GRAY_TEXT};margin:0;">We appreciate your commitment to learning and development.</p>
    `;
  }

  if (type === 'due_date_changed') {
    const dueDateLabel = meta.dueDate || meta.newDueDate || null;
    return `
      ${greeting}
      <p style="font-size:15px;color:${BODY_TEXT};margin:0 0 10px;">
        The due date for your assigned course on the <strong style="color:${PRIMARY};">AIA-VEGA Learning Portal</strong> has been updated.
      </p>
      ${courseChip(PRIMARY, PRIMARY_LIGHT)}
      ${buildInfoBlock('New due date', dueDateLabel, PRIMARY, PRIMARY_LIGHT)}
      <p style="font-size:14px;color:${GRAY_TEXT};margin:10px 0;">Please log in to the portal and complete the course before the new due date.</p>
      <p style="font-size:12px;color:${GRAY_TEXT};margin:0;">If you have any questions, please reach out to your Learning &amp; Development team.</p>
    `;
  }

  return `${greeting}<p style="font-size:15px;color:${BODY_TEXT};margin:0;">${escapeHtml(message)}</p>`;
}

function buildUserNotificationEmailHtml(type, title, message, meta = {}) {
  return wrapBrandedEmailHtml(title, buildNotificationBodyContent(type, message, meta));
}

function buildAdminEmailPlainText(title, message, meta = {}) {
  const lines = [title, '', message];
  if (meta.userName != null || meta.userId != null) {
    lines.push('', `User: ${meta.userName || `ID ${meta.userId}`}`);
  }
  if (meta.courseTitle != null || meta.courseId != null) {
    lines.push(`Course: ${meta.courseTitle || `ID ${meta.courseId}`}`);
  }
  if (meta.newsTitle != null || meta.newsId != null) {
    lines.push(`News: ${meta.newsTitle || meta.newsId}`);
  }
  return lines.join('\n');
}

function buildAdminNotificationEmailHtml(title, message, meta = {}) {
  const { PRIMARY, PRIMARY_LIGHT, GRAY_TEXT, BODY_TEXT } = EMAIL_THEME;
  const blocks = [];

  if (message) {
    blocks.push(`<p style="font-size:15px;color:${BODY_TEXT};margin:0 0 14px;">${escapeHtml(message)}</p>`);
  }
  if (meta.userName != null || meta.userId != null) {
    blocks.push(buildInfoBlock('User', meta.userName || `ID ${meta.userId}`, PRIMARY, PRIMARY_LIGHT));
  }
  if (meta.courseTitle != null || meta.courseId != null) {
    blocks.push(buildInfoBlock('Course', meta.courseTitle || `ID ${meta.courseId}`, PRIMARY, PRIMARY_LIGHT));
  }
  if (meta.newsTitle != null || meta.newsId != null) {
    blocks.push(buildInfoBlock('News', meta.newsTitle || meta.newsId, PRIMARY, PRIMARY_LIGHT));
  }

  blocks.push(`<p style="font-size:12px;color:${GRAY_TEXT};margin:16px 0 0;">Please review this update in the admin panel.</p>`);

  return wrapBrandedEmailHtml(title, blocks.join(''));
}

function buildForgotPasswordEmailHtml({ username, resetUrl }) {
  const { PRIMARY, GRAY_TEXT, BODY_TEXT } = EMAIL_THEME;
  const safeName = escapeHtml(String(username || '').trim() || 'User');
  const safeUrl = escapeHtml(resetUrl);

  const bodyContent = `
    <p style="font-size:15px;color:${BODY_TEXT};margin:0 0 14px;">Hello, <strong>${safeName}</strong>,</p>
    <p style="font-size:15px;color:${BODY_TEXT};margin:0 0 10px;">
      We received a request to reset your password for the <strong style="color:${PRIMARY};">AIA-VEGA Learning Portal</strong>.
    </p>
    <p style="font-size:14px;color:${GRAY_TEXT};margin:10px 0;">Use the link below to set a new password. This link is valid for a limited time.</p>
    <p style="font-size:14px;color:${BODY_TEXT};margin:16px 0;word-break:break-all;">
      <a href="${safeUrl}" style="color:${PRIMARY};text-decoration:underline;">${safeUrl}</a>
    </p>
    <p style="font-size:12px;color:${GRAY_TEXT};margin:0;">If you did not request a password reset, you can safely ignore this email.</p>
  `;

  return wrapBrandedEmailHtml('Reset your password', bodyContent);
}

function buildForgotPasswordPlainText({ username, resetUrl }) {
  const safeName = String(username || '').trim() || 'User';
  return [
    `Hello ${safeName},`,
    '',
    'We received a request to reset your password for the AIA-VEGA Learning Portal.',
    '',
    `Reset your password using this link: ${resetUrl}`,
    '',
    'If you did not request a password reset, you can safely ignore this email.',
  ].join('\n');
}

module.exports = {
  EMAIL_THEME,
  isEmailEnabled,
  wrapBrandedEmailHtml,
  buildUserNotificationEmailHtml,
  buildAdminNotificationEmailHtml,
  buildAdminEmailPlainText,
  buildForgotPasswordEmailHtml,
  buildForgotPasswordPlainText,
};
