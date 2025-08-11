const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

// Get system metrics
router.get('/', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    
    const metrics = {
      timestamp: new Date().toISOString(),
      system: {
        uptime: process.uptime(),
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          external: Math.round(process.memoryUsage().external / 1024 / 1024),
          rss: Math.round(process.memoryUsage().rss / 1024 / 1024)
        },
        cpu: process.cpuUsage(),
        pid: process.pid,
        version: process.version,
        platform: process.platform
      },
      services: {}
    };

    // Collect metrics from each service
    if (services.dbManager) {
      try {
        metrics.services.database = await services.dbManager.getStats();
      } catch (error) {
        metrics.services.database = { error: error.message };
      }
    }

    if (services.newsProcessor) {
      try {
        metrics.services.newsProcessor = services.newsProcessor.getStats();
      } catch (error) {
        metrics.services.newsProcessor = { error: error.message };
      }
    }

    if (services.deduplicationEngine) {
      try {
        metrics.services.deduplication = services.deduplicationEngine.getStats();
      } catch (error) {
        metrics.services.deduplication = { error: error.message };
      }
    }

    if (services.alertManager) {
      try {
        metrics.services.alerts = services.alertManager.getStats();
      } catch (error) {
        metrics.services.alerts = { error: error.message };
      }
    }

    res.json(metrics);

  } catch (error) {
    logger.error('Failed to get metrics:', error);
    res.status(500).json({ error: 'Failed to retrieve metrics' });
  }
});

// Get processing metrics over time
router.get('/processing', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    const dbManager = services.dbManager;
    
    if (!dbManager) {
      return res.status(503).json({ error: 'Database service not available' });
    }

    const hours = parseInt(req.query.hours) || 24;
    const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);

    const pipeline = [
      {
        $match: {
          timestamp: { $gte: startTime },
          type: { $in: ['feed_processing_cycle', 'article_processed', 'duplicate_detected'] }
        }
      },
      {
        $group: {
          _id: {
            hour: { $hour: '$timestamp' },
            type: '$type'
          },
          count: { $sum: 1 },
          avgDuration: { $avg: '$duration' }
        }
      },
      {
        $sort: { '_id.hour': 1 }
      }
    ];

    const metrics = await dbManager.mongodb.collection('metrics').aggregate(pipeline).toArray();

    res.json({
      timeRange: { hours, startTime },
      metrics
    });

  } catch (error) {
    logger.error('Failed to get processing metrics:', error);
    res.status(500).json({ error: 'Failed to retrieve processing metrics' });
  }
});

// Get duplicate detection metrics
router.get('/duplicates', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    const dbManager = services.dbManager;
    
    if (!dbManager) {
      return res.status(503).json({ error: 'Database service not available' });
    }

    const days = parseInt(req.query.days) || 7;
    const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Get duplicate statistics
    const duplicateStats = await dbManager.mongodb.collection('duplicates').aggregate([
      {
        $match: { createdAt: { $gte: startTime } }
      },
      {
        $group: {
          _id: {
            day: { $dayOfYear: '$createdAt' },
            method: '$detectionMethod'
          },
          count: { $sum: 1 },
          avgSimilarity: { $avg: '$similarityScore' }
        }
      },
      {
        $sort: { '_id.day': 1 }
      }
    ]).toArray();

    // Get method breakdown
    const methodStats = await dbManager.mongodb.collection('duplicates').aggregate([
      {
        $match: { createdAt: { $gte: startTime } }
      },
      {
        $group: {
          _id: '$detectionMethod',
          count: { $sum: 1 },
          avgSimilarity: { $avg: '$similarityScore' },
          minSimilarity: { $min: '$similarityScore' },
          maxSimilarity: { $max: '$similarityScore' }
        }
      }
    ]).toArray();

    res.json({
      timeRange: { days, startTime },
      dailyStats: duplicateStats,
      methodBreakdown: methodStats
    });

  } catch (error) {
    logger.error('Failed to get duplicate metrics:', error);
    res.status(500).json({ error: 'Failed to retrieve duplicate metrics' });
  }
});

// Get alert metrics
router.get('/alerts', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    const dbManager = services.dbManager;
    
    if (!dbManager) {
      return res.status(503).json({ error: 'Database service not available' });
    }

    const days = parseInt(req.query.days) || 7;
    const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Get alert statistics
    const alertStats = await dbManager.mongodb.collection('alerts').aggregate([
      {
        $match: { createdAt: { $gte: startTime } }
      },
      {
        $group: {
          _id: {
            day: { $dayOfYear: '$createdAt' },
            status: '$status'
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id.day': 1 }
      }
    ]).toArray();

    // Get channel performance
    const channelStats = await dbManager.mongodb.collection('alerts').aggregate([
      {
        $match: { 
          createdAt: { $gte: startTime },
          results: { $exists: true }
        }
      },
      {
        $unwind: '$results'
      },
      {
        $group: {
          _id: '$results.channel',
          totalAttempts: { $sum: 1 },
          successfulDeliveries: {
            $sum: { $cond: ['$results.success', 1, 0] }
          }
        }
      },
      {
        $addFields: {
          successRate: {
            $divide: ['$successfulDeliveries', '$totalAttempts']
          }
        }
      }
    ]).toArray();

    res.json({
      timeRange: { days, startTime },
      dailyStats: alertStats,
      channelPerformance: channelStats
    });

  } catch (error) {
    logger.error('Failed to get alert metrics:', error);
    res.status(500).json({ error: 'Failed to retrieve alert metrics' });
  }
});

// Get source performance metrics
router.get('/sources', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    const dbManager = services.dbManager;
    
    if (!dbManager) {
      return res.status(503).json({ error: 'Database service not available' });
    }

    const days = parseInt(req.query.days) || 7;
    const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Get source statistics
    const sourceStats = await dbManager.mongodb.collection('articles').aggregate([
      {
        $match: { createdAt: { $gte: startTime } }
      },
      {
        $group: {
          _id: '$source',
          totalArticles: { $sum: 1 },
          duplicates: {
            $sum: { $cond: ['$isDuplicate', 1, 0] }
          },
          uniqueArticles: {
            $sum: { $cond: [{ $not: '$isDuplicate' }, 1, 0] }
          },
          avgContentLength: {
            $avg: { $strLenCP: { $ifNull: ['$content', ''] } }
          }
        }
      },
      {
        $addFields: {
          duplicateRate: {
            $divide: ['$duplicates', '$totalArticles']
          },
          uniqueRate: {
            $divide: ['$uniqueArticles', '$totalArticles']
          }
        }
      },
      {
        $sort: { totalArticles: -1 }
      }
    ]).toArray();

    res.json({
      timeRange: { days, startTime },
      sourcePerformance: sourceStats
    });

  } catch (error) {
    logger.error('Failed to get source metrics:', error);
    res.status(500).json({ error: 'Failed to retrieve source metrics' });
  }
});

// Export metrics as Prometheus format
router.get('/prometheus', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    
    let prometheusMetrics = [];
    
    // System metrics
    const memoryUsage = process.memoryUsage();
    prometheusMetrics.push(`# HELP news_dedup_memory_heap_used_bytes Memory heap used in bytes`);
    prometheusMetrics.push(`# TYPE news_dedup_memory_heap_used_bytes gauge`);
    prometheusMetrics.push(`news_dedup_memory_heap_used_bytes ${memoryUsage.heapUsed}`);
    
    prometheusMetrics.push(`# HELP news_dedup_uptime_seconds Process uptime in seconds`);
    prometheusMetrics.push(`# TYPE news_dedup_uptime_seconds counter`);
    prometheusMetrics.push(`news_dedup_uptime_seconds ${process.uptime()}`);

    // Service metrics
    if (services.newsProcessor) {
      const stats = services.newsProcessor.getStats();
      prometheusMetrics.push(`# HELP news_dedup_articles_processed_total Total articles processed`);
      prometheusMetrics.push(`# TYPE news_dedup_articles_processed_total counter`);
      prometheusMetrics.push(`news_dedup_articles_processed_total ${stats.totalProcessed || 0}`);
      
      prometheusMetrics.push(`# HELP news_dedup_duplicates_detected_total Total duplicates detected`);
      prometheusMetrics.push(`# TYPE news_dedup_duplicates_detected_total counter`);
      prometheusMetrics.push(`news_dedup_duplicates_detected_total ${stats.totalDuplicates || 0}`);
    }

    if (services.alertManager) {
      const stats = services.alertManager.getStats();
      prometheusMetrics.push(`# HELP news_dedup_alerts_sent_total Total alerts sent`);
      prometheusMetrics.push(`# TYPE news_dedup_alerts_sent_total counter`);
      prometheusMetrics.push(`news_dedup_alerts_sent_total ${stats.successfulAlerts || 0}`);
      
      prometheusMetrics.push(`# HELP news_dedup_alerts_failed_total Total alerts failed`);
      prometheusMetrics.push(`# TYPE news_dedup_alerts_failed_total counter`);
      prometheusMetrics.push(`news_dedup_alerts_failed_total ${stats.failedAlerts || 0}`);
    }

    res.setHeader('Content-Type', 'text/plain');
    res.send(prometheusMetrics.join('\n') + '\n');

  } catch (error) {
    logger.error('Failed to generate Prometheus metrics:', error);
    res.status(500).send('# Error generating metrics\n');
  }
});

// Record custom metric
router.post('/custom', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    const dbManager = services.dbManager;
    
    if (!dbManager) {
      return res.status(503).json({ error: 'Database service not available' });
    }

    const { name, value, tags, type } = req.body;
    
    if (!name || value === undefined) {
      return res.status(400).json({ error: 'Name and value are required' });
    }

    const metric = {
      name,
      value: parseFloat(value),
      tags: tags || {},
      type: type || 'gauge',
      source: 'api',
      timestamp: new Date()
    };

    await dbManager.insertMetric(metric);
    
    res.status(201).json({ 
      message: 'Metric recorded successfully',
      metric
    });

  } catch (error) {
    logger.error('Failed to record custom metric:', error);
    res.status(500).json({ error: 'Failed to record metric' });
  }
});

module.exports = router;