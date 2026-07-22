'use strict';

module.exports = async (ctx) => {
  const user = ctx.state.user;

  if (!user) {
    return ctx.unauthorized('You must be logged in');
  }

  return true; 
};