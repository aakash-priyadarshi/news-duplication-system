const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

// Get all alerts with pagination
router.get('/', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    const alertManager = services.alertManager;
    
    if (!alertManager) {
      return res.status(503).json({ error: 'Alert service not available' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    
    // Get recent alerts
    const alerts = await alertManager.getRecentAlerts(limit);
    
    res.json({
      alerts,
      pagination: {
        page,
        limit,
        total: alerts.length
      }
    });

  } catch (error) {
    logger.error('Failed to get alerts:', error);
    res.status(500).json({ error: 'Failed to retrieve alerts' });
  }
});

// Get alerts by status
router.get('/status/:status', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    const alertManager = services.alertManager;
    
    if (!alertManager) {
      return res.status(503).json({ error: 'Alert service not available' });
    }

    const { status } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    
    const alerts = await alertManager.getAlertsByStatus(status, limit);
    
    res.json({ alerts, status, count: alerts.length });

  } catch (error) {
    logger.error('Failed to get alerts by status:', error);
    res.status(500).json({ error: 'Failed to retrieve alerts' });
  }
});

// Get alert statistics
router.get('/stats', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    const alertManager = services.alertManager;
    
    if (!alertManager) {
      return res.status(503).json({ error: 'Alert service not available' });
    }

    const stats = alertManager.getStats();
    
    res.json(stats);

  } catch (error) {
    logger.error('Failed to get alert stats:', error);
    res.status(500).json({ error: 'Failed to retrieve alert statistics' });
  }
});

// Send test alert
router.post('/test', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    const alertManager = services.alertManager;
    
    if (!alertManager) {
      return res.status(503).json({ error: 'Alert service not available' });
    }

    const testAlert = await alertManager.sendTestAlert();
    
    res.json({
      message: 'Test alert sent successfully',
      alert: testAlert
    });

  } catch (error) {
    logger.error('Failed to send test alert:', error);
    res.status(500).json({ error: 'Failed to send test alert' });
  }
});

// Create manual alert
router.post('/manual', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    const alertManager = services.alertManager;
    
    if (!alertManager) {
      return res.status(503).json({ error: 'Alert service not available' });
    }

    const { title, summary, priority, channels } = req.body;
    
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const alertData = {
      title,
      summary: summary || 'Manual alert triggered',
      source: 'Manual',
      category: 'manual',
      priority: priority || 'medium',
      url: req.body.url || 'http://localhost:3000',
      publishedAt: new Date(),
      entities: [],
      tags: req.body.tags || ['manual'],
      channels: channels || ['webhook']
    };

    const alert = await alertManager.createManualAlert(alertData);
    
    res.status(201).json({
      message: 'Manual alert created successfully',
      alert
    });

  } catch (error) {
    logger.error('Failed to create manual alert:', error);
    res.status(500).json({ error: 'Failed to create manual alert' });
  }
});

// Get specific alert
router.get('/:id', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    const dbManager = services.dbManager;
    
    if (!dbManager) {
      return res.status(503).json({ error: 'Database service not available' });
    }

    const alertId = req.params.id;
    const alert = await dbManager.mongodb.collection('alerts').findOne({ id: alertId });
    
    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    res.json({ alert });

  } catch (error) {
    logger.error('Failed to get alert:', error);
    res.status(500).json({ error: 'Failed to retrieve alert' });
  }
});

// Update alert status
router.patch('/:id/status', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    const dbManager = services.dbManager;
    
    if (!dbManager) {
      return res.status(503).json({ error: 'Database service not available' });
    }

    const alertId = req.params.id;
    const { status } = req.body;
    
    if (!['pending', 'sent', 'failed', 'cancelled'].includes(status)) {
      return res.status(400).json({ 
        error: 'Invalid status. Must be: pending, sent, failed, or cancelled' 
      });
    }

    const result = await dbManager.mongodb.collection('alerts').updateOne(
      { id: alertId },
      { 
        $set: { 
          status, 
          updatedAt: new Date() 
        } 
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    res.json({ message: 'Alert status updated successfully' });

  } catch (error) {
    logger.error('Failed to update alert status:', error);
    res.status(500).json({ error: 'Failed to update alert status' });
  }
});

// Delete alert
router.delete('/:id', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    const dbManager = services.dbManager;
    
    if (!dbManager) {
      return res.status(503).json({ error: 'Database service not available' });
    }

    const alertId = req.params.id;
    
    const result = await dbManager.mongodb.collection('alerts').deleteOne({ id: alertId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    res.json({ message: 'Alert deleted successfully' });

  } catch (error) {
    logger.error('Failed to delete alert:', error);
    res.status(500).json({ error: 'Failed to delete alert' });
  }
});

// Resend failed alert
router.post('/:id/resend', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    const alertManager = services.alertManager;
    const dbManager = services.dbManager;
    
    if (!alertManager || !dbManager) {
      return res.status(503).json({ error: 'Required services not available' });
    }

    const alertId = req.params.id;
    const alert = await dbManager.mongodb.collection('alerts').findOne({ id: alertId });
    
    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    if (alert.status === 'sent') {
      return res.status(400).json({ error: 'Alert already sent successfully' });
    }

    // Reset alert status and resend
    alert.status = 'pending';
    alert.resendCount = (alert.resendCount || 0) + 1;
    alert.lastResendAt = new Date();
    
    await alertManager.sendAlert(alert);
    
    res.json({ 
      message: 'Alert resent successfully',
      resendCount: alert.resendCount
    });

  } catch (error) {
    logger.error('Failed to resend alert:', error);
    res.status(500).json({ error: 'Failed to resend alert' });
  }
});

// Get alert delivery details
router.get('/:id/delivery', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    const dbManager = services.dbManager;
    
    if (!dbManager) {
      return res.status(503).json({ error: 'Database service not available' });
    }

    const alertId = req.params.id;
    const alert = await dbManager.mongodb.collection('alerts').findOne({ id: alertId });
    
    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    const delivery = {
      alertId: alert.id,
      status: alert.status,
      channels: alert.channels || [],
      results: alert.results || [],
      sentAt: alert.sentAt,
      createdAt: alert.createdAt,
      resendCount: alert.resendCount || 0,
      lastResendAt: alert.lastResendAt
    };

    res.json({ delivery });

  } catch (error) {
    logger.error('Failed to get alert delivery details:', error);
    res.status(500).json({ error: 'Failed to retrieve delivery details' });
  }
});

// Bulk operations
router.post('/bulk/delete', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    const dbManager = services.dbManager;
    
    if (!dbManager) {
      return res.status(503).json({ error: 'Database service not available' });
    }

    const { alertIds, status } = req.body;
    
    let filter = {};
    
    if (alertIds && Array.isArray(alertIds)) {
      filter.id = { $in: alertIds };
    } else if (status) {
      filter.status = status;
    } else {
      return res.status(400).json({ 
        error: 'Either alertIds array or status must be provided' 
      });
    }

    const result = await dbManager.mongodb.collection('alerts').deleteMany(filter);
    
    res.json({ 
      message: `Deleted ${result.deletedCount} alerts`,
      deletedCount: result.deletedCount
    });

  } catch (error) {
    logger.error('Failed to bulk delete alerts:', error);
    res.status(500).json({ error: 'Failed to delete alerts' });
  }
});

// Export alerts
router.get('/export/csv', async (req, res) => {
  try {
    const services = req.app.locals.services || {};
    const dbManager = services.dbManager;
    
    if (!dbManager) {
      return res.status(503).json({ error: 'Database service not available' });
    }

    const { status, from, to, limit = 1000 } = req.query;
    
    let filter = {};
    
    if (status) filter.status = status;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }

    const alerts = await dbManager.mongodb.collection('alerts')
      .find(filter)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 })
      .toArray();

    // Convert to CSV
    const csvHeaders = 'ID,Title,Source,Category,Priority,Status,Created,Sent,Channels';
    const csvRows = alerts.map(alert => 
      `"${alert.id}","${alert.title}","${alert.source}","${alert.category}","${alert.priority}","${alert.status}","${alert.createdAt}","${alert.sentAt || ''}","${(alert.channels || []).join(';')}"`
    );
    
    const csv = [csvHeaders, ...csvRows].join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="alerts.csv"');
    res.send(csv);

  } catch (error) {
    logger.error('Failed to export alerts:', error);
    res.status(500).json({ error: 'Failed to export alerts' });
  }
});

module.exports = router;