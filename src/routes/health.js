const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

// Basic health check
router.get('/', async (req, res) => {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      node_version: process.version,
      environment: process.env.NODE_ENV || 'development'
    };

    res.json(health);
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Detailed health check
router.get('/detailed', async (req, res) => {
  try {
    // This will be populated by the main app
    const services = req.app.locals.services || {};
    
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      services: {},
      system: {
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          external: Math.round(process.memoryUsage().external / 1024 / 1024)
        },
        cpu: process.cpuUsage(),
        pid: process.pid,
        platform: process.platform,
        arch: process.arch
      }
    };

    // Check database health
    if (services.dbManager) {
      try {
        const dbHealth = await services.dbManager.getHealthStatus();
        health.services.database = dbHealth;
      } catch (error) {
        health.services.database = { status: 'error', error: error.message };
        health.status = 'degraded';
      }
    }

    // Check other services
    const serviceChecks = ['newsProcessor', 'deduplicationEngine', 'alertManager'];
    
    for (const serviceName of serviceChecks) {
      if (services[serviceName]) {
        try {
          health.services[serviceName] = {
            status: 'healthy',
            stats: services[serviceName].getStats ? services[serviceName].getStats() : {}
          };
        } catch (error) {
          health.services[serviceName] = {
            status: 'error',
            error: error.message
          };
          health.status = 'degraded';
        }
      } else {
        health.services[serviceName] = { status: 'not_initialized' };
        health.status = 'degraded';
      }
    }

    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);

  } catch (error) {
    logger.error('Detailed health check failed:', error);
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Readiness check (for Kubernetes)
router.get('/ready', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    
    // Check if critical services are ready
    const criticalServices = ['dbManager'];
    let ready = true;
    const checks = {};

    for (const serviceName of criticalServices) {
      if (services[serviceName]) {
        try {
          if (serviceName === 'dbManager') {
            const dbHealth = await services[serviceName].getHealthStatus();
            checks[serviceName] = dbHealth.overall;
          } else {
            checks[serviceName] = true;
          }
        } catch (error) {
          checks[serviceName] = false;
          ready = false;
        }
      } else {
        checks[serviceName] = false;
        ready = false;
      }
    }

    const response = {
      ready,
      checks,
      timestamp: new Date().toISOString()
    };

    res.status(ready ? 200 : 503).json(response);

  } catch (error) {
    logger.error('Readiness check failed:', error);
    res.status(503).json({
      ready: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Liveness check (for Kubernetes)
router.get('/live', (req, res) => {
  res.json({
    alive: true,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

module.exports = router;