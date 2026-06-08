const express = require('express');
const app = require('./app');

function listRoutes(app) {
  const routes = [];
  
  function processRoute(path, layer) {
    if (layer.route) {
      layer.route.stack.forEach(r => {
        routes.push({
          method: r.method.toUpperCase(),
          path: path + (layer.route.path === '/' ? '' : layer.route.path)
        });
      });
    } else if (layer.name === 'router' && layer.handle.stack) {
      layer.handle.stack.forEach(r => {
        let newPath = path + (layer.regexp.source !== '^\\/?$' ? 
          layer.regexp.source.replace('^\\/', '/').replace('\\/?(?=\\/|$)', '').replace('^', '').replace('\\/', '/') : '');
        // simple regex cleanup for standard express mounts
        newPath = newPath.replace(/\?\(\?=\\\/\|\$\)/g, '').replace(/\\\//g, '/').replace(/^\^/, '').replace(/\/?\(\?=\/\|\$\)/g, '');
        processRoute(newPath, r);
      });
    }
  }

  app._router.stack.forEach(layer => {
    processRoute('', layer);
  });
  
  return routes;
}

const routes = listRoutes(app);
const fs = require('fs');
fs.writeFileSync('routes.json', JSON.stringify(routes, null, 2));
console.log('Dumped', routes.length, 'routes');
process.exit(0);
