const logger = require('./logger');

class HealthChecker {
  constructor() {
    this.services = {};
    this.isMonitoring = false;
    this.checkInterval = null;
    this.healthHistory = [];
    this.maxHistorySize = 100;
  }

  startMonitoring(services) {
    this.services = services;
    this.isMonitoring = true;
    
    // Check health every 30 seconds
    this.checkInterval = setInterval(() => {
      this.performHealthCheck();
    }, 30000);
    
    logger.info('🏥 Health monitoring started');
    
    // Perform initial health check
    this.performHealthCheck();
  }

  async performHealthCheck() {
    try {
      const healthStatus = {
        timestamp: new Date(),
        overall: 'healthy',
        services: {}
      };

      // Check database health
      if (this.services.dbManager) {
        try {
          const dbHealth = await this.services.dbManager.getHealthStatus();
          healthStatus.services.database = dbHealth;
          if (!dbHealth.overall) {
            healthStatus.overall = 'degraded';
          }
        } catch (error) {
          healthStatus.services.database = { status: 'error', error: error.message };
          healthStatus.overall = 'unhealthy';
        }
      }

      // Check other services
      const serviceNames = ['newsProcessor', 'deduplicationEngine', 'alertManager'];
      
      for (const serviceName of serviceNames) {
        if (this.services[serviceName]) {
          try {
            const stats = this.services[serviceName].getStats();
            healthStatus.services[serviceName] = {
              status: 'healthy',
              ...stats
            };
          } catch (error) {
            healthStatus.services[serviceName] = {
              status: 'error',
              error: error.message
            };
            healthStatus.overall = 'degraded';
          }
        }
      }

      // Store health history
      this.addToHistory(healthStatus);
      
      // Log if status changed
      if (this.hasStatusChanged(healthStatus)) {
        logger.info(`🏥 Health status: ${healthStatus.overall}`);
      }

    } catch (error) {
      logger.error('Health check failed:', error);
    }
  }

  addToHistory(healthStatus) {
    this.healthHistory.push(healthStatus);
    
    // Keep only recent history
    if (this.healthHistory.length > this.maxHistorySize) {
      this.healthHistory.shift();
    }
  }

  hasStatusChanged(currentStatus) {
    if (this.healthHistory.length < 2) return true;
    
    const lastStatus = this.healthHistory[this.healthHistory.length - 2];
    return lastStatus.overall !== currentStatus.overall;
  }

  getHealthStatus() {
    if (this.healthHistory.length === 0) {
      return {
        status: 'unknown',
        message: 'No health checks performed yet'
      };
    }
    
    return this.healthHistory[this.healthHistory.length - 1];
  }

  getHealthHistory(limit = 10) {
    return this.healthHistory.slice(-limit);
  }

  stopMonitoring() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    
    this.isMonitoring = false;
    logger.info('🏥 Health monitoring stopped');
  }

  // Manual health check trigger
  async checkHealth() {
    await this.performHealthCheck();
    return this.getHealthStatus();
  }

  // Check if system is ready
  isSystemReady() {
    const currentHealth = this.getHealthStatus();
    return currentHealth.overall === 'healthy' || currentHealth.overall === 'degraded';
  }

  // Get uptime and basic system info
  getSystemInfo() {
    return {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      pid: process.pid,
      platform: process.platform,
      nodeVersion: process.version,
      isMonitoring: this.isMonitoring
    };
  }
}

module.exports = HealthChecker;