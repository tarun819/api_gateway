// src/router.js
// Path-based request router — the piece that makes this an API Gateway.
//
// Given a request URL like /api/users/123, this module finds the matching
// backend pool from the route table in config.js using longest-prefix matching.
//
// Why longest-prefix? Because routes can overlap:
//   '/api'        → general API pool
//   '/api/users'  → user service pool
// A request to /api/users/123 should match '/api/users', not '/api'.
// Longest prefix ensures the most specific route wins.

const config = require('./config');


const sortedRoutes = Object.entries(config.routes)
  .sort((a, b) => b[0].length - a[0].length);


function matchRoute(url) {
  for (const [prefix, pool] of sortedRoutes) {

    if (url === prefix
      || url.startsWith(prefix + '/')
      || url.startsWith(prefix + '?')) {
      return { prefix, pool };
    }
  }
  return null;
}

module.exports = { matchRoute };
